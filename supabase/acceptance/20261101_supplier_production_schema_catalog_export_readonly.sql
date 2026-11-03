-- Read-only catalog export for building an isolated local schema baseline.
-- Run only after verifying the Supabase dashboard header is zaoyoe / main PRODUCTION.
-- This reads PostgreSQL catalogs and function/view definitions only; it does not
-- read application rows, alter database state, or apply migrations.
SELECT jsonb_pretty(jsonb_build_object(
    'capture', jsonb_build_object(
        'database', current_database(),
        'server_version', current_setting('server_version'),
        'current_user', current_user,
        'schema_scope', 'public'
    ),
    'schema', (
        SELECT jsonb_build_object(
            'name', n.nspname,
            'owner', pg_get_userbyid(n.nspowner),
            'acl', n.nspacl::text,
            'comment', obj_description(n.oid, 'pg_namespace')
        )
        FROM pg_namespace AS n
        WHERE n.nspname = 'public'
    ),
    'extensions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'name', e.extname,
            'version', e.extversion,
            'schema', n.nspname
        ) ORDER BY e.extname)
        FROM pg_extension AS e
        JOIN pg_namespace AS n ON n.oid = e.extnamespace
    ), '[]'::jsonb),
    'relations', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'name', c.relname,
            'kind', c.relkind,
            'owner', pg_get_userbyid(c.relowner),
            'persistence', c.relpersistence,
            'row_level_security', c.relrowsecurity,
            'force_row_level_security', c.relforcerowsecurity,
            'acl', c.relacl::text,
            'comment', obj_description(c.oid, 'pg_class'),
            'partition_key', CASE WHEN c.relkind = 'p'
                THEN pg_get_partkeydef(c.oid) ELSE NULL END,
            'columns', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'name', a.attname,
                    'type', format_type(a.atttypid, a.atttypmod),
                    'nullable', NOT a.attnotnull,
                    'default', pg_get_expr(d.adbin, d.adrelid),
                    'identity', NULLIF(a.attidentity, ''),
                    'generated', NULLIF(a.attgenerated, ''),
                    'collation', CASE WHEN a.attcollation = 0 THEN NULL
                        ELSE a.attcollation::regcollation::text END,
                    'comment', col_description(c.oid, a.attnum)
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
                    'deferrable', con.condeferrable,
                    'initially_deferred', con.condeferred
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
                    'permissive', p.permissive,
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
            'view_definition', CASE WHEN c.relkind IN ('v', 'm')
                THEN pg_get_viewdef(c.oid, true) ELSE NULL END
        ) ORDER BY c.relname)
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    ), '[]'::jsonb),
    'types', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'name', t.typname,
            'kind', t.typtype,
            'owner', pg_get_userbyid(t.typowner),
            'base_type', CASE WHEN t.typtype = 'd'
                THEN format_type(t.typbasetype, t.typtypmod) ELSE NULL END,
            'not_null', t.typnotnull,
            'default', t.typdefault,
            'enum_labels', CASE WHEN t.typtype = 'e' THEN (
                SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
                FROM pg_enum AS e
                WHERE e.enumtypid = t.oid
            ) ELSE NULL END,
            'composite_attributes', CASE WHEN t.typtype = 'c' THEN (
                SELECT jsonb_agg(jsonb_build_object(
                    'name', a.attname,
                    'type', format_type(a.atttypid, a.atttypmod),
                    'nullable', NOT a.attnotnull
                ) ORDER BY a.attnum)
                FROM pg_attribute AS a
                WHERE a.attrelid = t.typrelid
                  AND a.attnum > 0
                  AND NOT a.attisdropped
            ) ELSE NULL END,
            'domain_constraints', CASE WHEN t.typtype = 'd' THEN (
                SELECT jsonb_agg(jsonb_build_object(
                    'name', con.conname,
                    'definition', pg_get_constraintdef(con.oid, true),
                    'validated', con.convalidated
                ) ORDER BY con.conname)
                FROM pg_constraint AS con
                WHERE con.contypid = t.oid
            ) ELSE NULL END,
            'range', CASE WHEN t.typtype = 'r' THEN (
                SELECT jsonb_build_object(
                    'subtype', format_type(r.rngsubtype, NULL),
                    'subtype_opclass', r.rngsubopc::regclass::text,
                    'collation', NULLIF(r.rngcollation, 0)::regcollation::text,
                    'canonical_function', NULLIF(r.rngcanonical, 0)::regprocedure::text,
                    'subdiff_function', NULLIF(r.rngsubdiff, 0)::regprocedure::text
                )
                FROM pg_range AS r
                WHERE r.rngtypid = t.oid
            ) ELSE NULL END,
            'comment', obj_description(t.oid, 'pg_type')
        ) ORDER BY t.typname)
        FROM pg_type AS t
        JOIN pg_namespace AS n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typrelid = 0
          AND t.typtype IN ('d', 'e', 'c', 'r', 'm')
    ), '[]'::jsonb),
    'functions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'name', p.proname,
            'identity_arguments', pg_get_function_identity_arguments(p.oid),
            'return_type', pg_get_function_result(p.oid),
            'kind', p.prokind,
            'language', l.lanname,
            'owner', pg_get_userbyid(p.proowner),
            'security_definer', p.prosecdef,
            'strict', p.proisstrict,
            'volatility', p.provolatile,
            'parallel', p.proparallel,
            'configuration', p.proconfig,
            'acl', p.proacl::text,
            'definition', pg_get_functiondef(p.oid)
        ) ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))
        FROM pg_proc AS p
        JOIN pg_namespace AS n ON n.oid = p.pronamespace
        JOIN pg_language AS l ON l.oid = p.prolang
        WHERE n.nspname = 'public'
          AND p.prokind IN ('f', 'p', 'w')
    ), '[]'::jsonb)
)) AS public_schema_catalog_export;
