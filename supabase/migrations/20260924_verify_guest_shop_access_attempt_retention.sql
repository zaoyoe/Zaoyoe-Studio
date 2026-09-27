-- Read-only verification for 20260924_guest_shop_access_attempt_retention.sql.
-- Codex does not execute this file. Every row must report PASS before enabling
-- GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED.

WITH fn_family AS (
    SELECT
        p.oid,
        p.proowner,
        p.proacl,
        owner_role.rolname AS owner_name,
        p.prosecdef AS security_definer,
        COALESCE(p.proconfig, ARRAY[]::TEXT[]) AS proconfig,
        pg_get_function_result(p.oid) AS result_type,
        pg_get_functiondef(p.oid) AS def
    FROM pg_proc AS p
    JOIN pg_namespace AS function_namespace ON function_namespace.oid = p.pronamespace
    JOIN pg_roles AS owner_role ON owner_role.oid = p.proowner
    WHERE function_namespace.nspname = 'public'
      AND p.proname = 'fn_guest_shop_purge_access_attempts'
), fn AS (
    SELECT *
    FROM fn_family
    WHERE oid = to_regprocedure(
        'public.fn_guest_shop_purge_access_attempts(timestamp with time zone, integer)'
    )
), fn_grants AS (
    SELECT
        fn_family.oid AS function_oid,
        fn_family.owner_name,
        fn_family.proowner,
        COALESCE(r.rolname, 'PUBLIC') AS grantee,
        g.grantor,
        g.privilege_type,
        g.is_grantable
    FROM fn_family
    CROSS JOIN LATERAL aclexplode(
        COALESCE(fn_family.proacl, acldefault('f', fn_family.proowner))
    ) AS g
    LEFT JOIN pg_roles AS r ON r.oid = g.grantee
), fn_effective_privileges AS (
    SELECT
        fn_family.oid AS function_oid,
        has_function_privilege('anon', fn_family.oid, 'EXECUTE') AS anon_can_execute,
        has_function_privilege('authenticated', fn_family.oid, 'EXECUTE') AS authenticated_can_execute,
        has_function_privilege('service_role', fn_family.oid, 'EXECUTE') AS service_role_can_execute
    FROM fn_family
), retention_index AS (
    SELECT
        index_state.indisvalid,
        index_state.indisready,
        index_state.indpred IS NULL AS is_not_partial,
        index_state.indexprs IS NULL AS is_not_expression,
        index_state.indnatts,
        index_state.indnkeyatts,
        access_method.amname AS access_method,
        NOT EXISTS (
            SELECT 1
            FROM unnest(index_state.indoption) AS option_bits
            WHERE (option_bits::INTEGER & 3) <> 0
        ) AS is_ascending_nulls_last,
        ARRAY(
            SELECT table_attribute.attname
            FROM unnest(index_state.indkey) WITH ORDINALITY AS index_key(attnum, position)
            JOIN pg_attribute AS table_attribute
              ON table_attribute.attrelid = index_state.indrelid
             AND table_attribute.attnum = index_key.attnum
            WHERE index_key.position <= index_state.indnkeyatts
            ORDER BY index_key.position
        ) AS key_columns
    FROM pg_class AS index_relation
    JOIN pg_namespace AS index_namespace ON index_namespace.oid = index_relation.relnamespace
    JOIN pg_index AS index_state ON index_state.indexrelid = index_relation.oid
    JOIN pg_class AS table_relation ON table_relation.oid = index_state.indrelid
    JOIN pg_namespace AS table_namespace ON table_namespace.oid = table_relation.relnamespace
    JOIN pg_am AS access_method ON access_method.oid = index_relation.relam
    WHERE index_namespace.nspname = 'public'
      AND index_relation.relname = 'guest_shop_access_attempts_retention_idx'
      AND table_namespace.nspname = 'public'
      AND table_relation.relname = 'guest_shop_access_attempts'
), checks AS (
    SELECT
        1 AS sort_order,
        'retention_index'::TEXT AS check_name,
        COALESCE((
            SELECT COUNT(*) = 1
               AND bool_and(indisvalid)
               AND bool_and(indisready)
               AND bool_and(is_not_partial)
               AND bool_and(is_not_expression)
               AND bool_and(indnatts = 2)
               AND bool_and(indnkeyatts = 2)
               AND bool_and(access_method = 'btree')
               AND bool_and(is_ascending_nulls_last)
               AND bool_and(key_columns = ARRAY['created_at', 'id']::NAME[])
            FROM retention_index
        ), false) AS passed,
        COALESCE((SELECT jsonb_agg(to_jsonb(retention_index))::TEXT FROM retention_index), '[]') AS observed,
        'one valid ready non-partial btree on exactly (created_at ASC, id ASC)'::TEXT AS expected
    UNION ALL
    SELECT
        2,
        'purge_function_present',
        (SELECT COUNT(*) = 1 FROM fn)
          AND (SELECT COUNT(*) = 1 FROM fn_family),
        jsonb_build_object(
            'exact_signature_count', (SELECT COUNT(*) FROM fn),
            'same_name_overload_count', (SELECT COUNT(*) FROM fn_family)
        )::TEXT,
        'exact signature present and same-name overload count = 1'
    UNION ALL
    SELECT
        3,
        'purge_function_owner',
        COALESCE((SELECT bool_and(owner_name IN ('postgres', 'supabase_admin')) FROM fn_family), false),
        COALESCE((SELECT jsonb_agg(owner_name ORDER BY owner_name)::TEXT FROM fn_family), '[]'),
        'postgres or supabase_admin'
    UNION ALL
    SELECT
        4,
        'purge_function_security',
        COALESCE((
            SELECT security_definer
               AND proconfig @> ARRAY['search_path=pg_catalog, pg_temp']::TEXT[]
            FROM fn
        ), false),
        COALESCE((SELECT jsonb_build_object(
            'security_definer', security_definer,
            'proconfig', proconfig
        )::TEXT FROM fn), 'missing'),
        '{"security_definer": true, "search_path": "pg_catalog, pg_temp"}'
    UNION ALL
    SELECT
        5,
        'purge_function_result_contract',
        COALESCE((
            SELECT result_type = 'TABLE(deleted_count integer, has_more boolean)'
            FROM fn
        ), false),
        COALESCE((SELECT result_type FROM fn), 'missing'),
        'TABLE(deleted_count integer, has_more boolean)'
    UNION ALL
    SELECT
        6,
        'purge_function_body',
        COALESCE((
            SELECT def LIKE '%guest_shop_access_attempts%'
               AND def LIKE '%created_at < p_cutoff%'
               AND def LIKE '%LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 1000)%'
               AND def LIKE '%LIMIT (v_limit + 1)%'
               AND def LIKE '%FOR UPDATE SKIP LOCKED%'
               AND def LIKE '%LIMIT v_limit%'
               AND def LIKE '%DELETE FROM public.guest_shop_access_attempts%'
               AND def LIKE '%COUNT(*) > v_limit FROM candidates%'
               AND def LIKE '%PERFORM public.guest_shop_require_service_role()%'
               AND def LIKE '%pg_catalog.pg_advisory_xact_lock%'
            FROM fn
        ), false),
        COALESCE((SELECT 'function body present' FROM fn), 'missing'),
        'service-role guarded, serialized p_limit + 1 look-ahead, p_limit victims, SKIP LOCKED and has_more'
    UNION ALL
    SELECT
        7,
        'purge_function_grants',
        EXISTS (
            SELECT 1 FROM fn_grants
            WHERE function_oid = (SELECT oid FROM fn)
              AND grantee = 'service_role'
              AND privilege_type = 'EXECUTE'
              AND NOT is_grantable
              AND grantor = proowner
        )
        AND NOT EXISTS (
            SELECT 1 FROM fn_grants
            WHERE privilege_type = 'EXECUTE'
              AND grantee NOT IN (owner_name, 'service_role')
        )
        AND NOT EXISTS (
            SELECT 1 FROM fn_grants
            WHERE grantee = 'service_role'
              AND privilege_type = 'EXECUTE'
              AND (is_grantable OR grantor <> proowner)
        )
        AND COALESCE((
            SELECT bool_and(
                NOT anon_can_execute
                AND NOT authenticated_can_execute
                AND service_role_can_execute
            )
            FROM fn_effective_privileges
        ), false),
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'grantee', grantee,
            'privilege', privilege_type,
            'grantable', is_grantable
        ) ORDER BY grantee)::TEXT FROM fn_grants), '[]'),
        'owner and non-grantable service_role EXECUTE only; anon/authenticated have no effective EXECUTE'
)
SELECT
    check_name,
    CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS status,
    observed,
    expected
FROM checks
ORDER BY sort_order;
