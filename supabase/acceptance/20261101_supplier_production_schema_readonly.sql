-- Read-only schema reference for the Xiareng supplier integration.
-- Run only against the verified zaoyoe main PRODUCTION project with the
-- dashboard's read-only query mode enabled. This reads catalog metadata only;
-- it does not read application rows, credentials, or function bodies.
SELECT jsonb_pretty(jsonb_build_object(
    'capture', jsonb_build_object(
        'database', current_database(),
        'server_version', current_setting('server_version'),
        'schema_scope', 'public supplier and shop/guest-shop relations'
    ),
    'relations', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'name', c.relname,
            'kind', c.relkind,
            'row_level_security', c.relrowsecurity,
            'force_row_level_security', c.relforcerowsecurity,
            'columns', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'name', a.attname,
                    'type', format_type(a.atttypid, a.atttypmod),
                    'nullable', NOT a.attnotnull,
                    'default', pg_get_expr(d.adbin, d.adrelid),
                    'identity', NULLIF(a.attidentity, ''),
                    'generated', NULLIF(a.attgenerated, '')
                ) ORDER BY a.attnum)
                FROM pg_attribute AS a
                LEFT JOIN pg_attrdef AS d
                    ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                WHERE a.attrelid = c.oid
                  AND a.attnum > 0
                  AND NOT a.attisdropped
            ), '[]'::jsonb),
            'constraints', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'name', con.conname,
                    'type', con.contype,
                    'definition', pg_get_constraintdef(con.oid, true),
                    'validated', con.convalidated,
                    'deferrable', con.condeferrable
                ) ORDER BY con.conname)
                FROM pg_constraint AS con
                WHERE con.conrelid = c.oid
            ), '[]'::jsonb),
            'indexes', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'name', idx.relname,
                    'definition', pg_get_indexdef(i.indexrelid)
                ) ORDER BY idx.relname)
                FROM pg_index AS i
                JOIN pg_class AS idx ON idx.oid = i.indexrelid
                WHERE i.indrelid = c.oid
            ), '[]'::jsonb),
            'policies', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'name', p.policyname,
                    'command', p.cmd,
                    'roles', p.roles,
                    'using', p.qual,
                    'with_check', p.with_check
                ) ORDER BY p.policyname)
                FROM pg_policies AS p
                WHERE p.schemaname = n.nspname
                  AND p.tablename = c.relname
            ), '[]'::jsonb),
            'triggers', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'name', t.tgname,
                    'definition', pg_get_triggerdef(t.oid, true)
                ) ORDER BY t.tgname)
                FROM pg_trigger AS t
                WHERE t.tgrelid = c.oid
                  AND NOT t.tgisinternal
            ), '[]'::jsonb),
            'view_definition', CASE
                WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid, true)
                ELSE NULL
            END
        ) ORDER BY c.relname)
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p', 'v', 'm')
          AND (
              c.relname LIKE 'shop_supplier_%'
              OR c.relname LIKE 'shop_%'
              OR c.relname LIKE 'guest_shop_%'
              OR c.relname IN ('admin_audit_logs', 'points_ledger')
          )
    ), '[]'::jsonb),
    'supplier_functions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'name', p.proname,
            'identity_arguments', pg_get_function_identity_arguments(p.oid),
            'return_type', pg_get_function_result(p.oid),
            'language', l.lanname,
            'security_definer', p.prosecdef,
            'volatility', p.provolatile,
            'configuration', p.proconfig
        ) ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        JOIN pg_language AS l ON l.oid = p.prolang
        WHERE n.nspname = 'public'
          AND p.proname LIKE '%shop_supplier%'
    ), '[]'::jsonb),
    'supplier_related_types', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'name', t.typname,
            'kind', t.typtype,
            'labels', CASE WHEN t.typtype = 'e' THEN (
                SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
                FROM pg_enum AS e
                WHERE e.enumtypid = t.oid
            ) ELSE NULL END
        ) ORDER BY t.typname)
        FROM pg_type AS t
        JOIN pg_namespace AS n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND (
              t.typname LIKE '%shop_supplier%'
              OR t.typname IN (
                  SELECT DISTINCT a.atttypid::regtype::text
                  FROM pg_attribute AS a
                  JOIN pg_class AS c ON c.oid = a.attrelid
                  JOIN pg_namespace AS rn ON rn.oid = c.relnamespace
                  WHERE rn.nspname = 'public'
                    AND c.relname LIKE 'shop_supplier_%'
                    AND a.attnum > 0
                    AND NOT a.attisdropped
              )
          )
    ), '[]'::jsonb)
)) AS schema_only_reference;
