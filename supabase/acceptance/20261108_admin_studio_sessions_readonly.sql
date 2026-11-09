-- Prepared locally on 2026-11-08. NOT EXECUTED by Codex.
-- Verify target project/environment and obtain execution authorization first.
-- Catalog-only acceptance for migration 20261108041927.
-- Migration SHA256: 7b187b90d94bb238dda00fa22bb5bfd93478526f032f6a08bcdf83c0a884d331
-- Reads pg_catalog only. Never calls application RPCs or reads auth/user/order rows.
-- PASS_CATALOG is catalog evidence only, not PostgREST, concurrency or production acceptance.
-- SOURCE_MATCH checks body bytes; a mismatch requires semantic review, not a rewrite to force PASS.
-- Run the COMPLETE file in one session. Any error means NOT VERIFIED. Do not remove checks.
BEGIN TRANSACTION READ ONLY;
SET LOCAL search_path = pg_catalog;

SELECT current_database() AS database_name, current_user AS verifier_role,
       current_setting('server_version') AS postgres_version,
       current_setting('transaction_read_only') AS transaction_read_only,
       'Project/environment must be verified outside SQL; database name alone is insufficient' AS boundary;

WITH expected_functions(schema_name, function_name, argument_types, security_definer, language_name,
                        default_count, argument_names, body_md5) AS (VALUES
    ('private', 'admin_auth_session_active', 'uuid,uuid', true, 'sql', 0, '{p_user_id,p_source_session_id}'::text[], 'a4117078b69658d18c6992128a6fb84f'),
    ('private', 'admin_studio_session_active', 'uuid,uuid,timestamptz', true, 'sql', 0, '{p_id,p_user_id,p_expires_at}'::text[], '17a980b4fd9947533bbccaf8f37548b5'),
    ('private', 'admin_studio_session_create', 'uuid,uuid,uuid,timestamptz', true, 'plpgsql', 0, '{p_id,p_user_id,p_source_session_id,p_expires_at}'::text[], 'e146c3f952acead58d25063f84024ab9'),
    ('private', 'admin_studio_session_revoke', 'uuid,uuid,uuid', true, 'plpgsql', 2, '{p_user_id,p_id,p_source_session_id}'::text[], '7dab24c066257b35d4b01e945e33f9d8'),
    ('private', 'admin_studio_session_discard', 'uuid,uuid', true, 'plpgsql', 0, '{p_id,p_user_id}'::text[], '605e1f9b2919f011a0424cf8fc7635ba'),
    ('public', 'admin_auth_session_active', 'uuid,uuid', false, 'sql', 0, '{p_user_id,p_source_session_id}'::text[], '3662b218ae2fba2e1d6ac5556de4ec2e'),
    ('public', 'admin_studio_session_active', 'uuid,uuid,timestamptz', false, 'sql', 0, '{p_id,p_user_id,p_expires_at}'::text[], 'c77b9a186da01138e6031ea1da83ad00'),
    ('public', 'admin_studio_session_create', 'uuid,uuid,uuid,timestamptz', false, 'sql', 0, '{p_id,p_user_id,p_source_session_id,p_expires_at}'::text[], 'f1eae17b5376809869161181615aadd6'),
    ('public', 'admin_studio_session_revoke', 'uuid,uuid,uuid', false, 'sql', 2, '{p_user_id,p_id,p_source_session_id}'::text[], '897c4c5ae26c3edebf254bbc2589d522'),
    ('public', 'admin_studio_session_discard', 'uuid,uuid', false, 'sql', 0, '{p_id,p_user_id}'::text[], 'a32e553dce09ab845b7da27f26a38c62')
),
expected_tables(table_name, column_names, column_types, not_nulls, primary_key) AS (VALUES
    ('admin_studio_sessions',
     ARRAY['id','user_id','source_session_id','expires_at','revoked_at','created_at'],
     ARRAY['uuid','uuid','uuid','timestamp with time zone','timestamp with time zone','timestamp with time zone'],
     ARRAY[true,true,true,true,false,true], 'id'),
    ('admin_studio_revoked_sources',
     ARRAY['source_session_id','user_id','revoked_at'],
     ARRAY['uuid','uuid','timestamp with time zone'],
     ARRAY[true,true,true], 'source_session_id')
),
functions AS (
    SELECT e.*, p.oid, p.proowner, p.prosecdef, p.provolatile, p.prorettype, p.proretset,
           p.prokind, p.proconfig, p.proacl, p.prosrc, p.proargnames, p.pronargdefaults,
           p.proargdefaults, l.lanname
    FROM expected_functions e
    LEFT JOIN pg_catalog.pg_proc p ON p.oid = pg_catalog.to_regprocedure(
        e.schema_name || '.' || e.function_name || '(' || e.argument_types || ')')
    LEFT JOIN pg_catalog.pg_language l ON l.oid = p.prolang
),
tables AS (
    SELECT e.*, c.oid, c.relowner, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relacl,
           (SELECT array_agg(a.attname::text ORDER BY a.attnum)
            FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS actual_names,
           (SELECT array_agg(pg_catalog.format_type(a.atttypid,a.atttypmod) ORDER BY a.attnum)
            FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS actual_types,
           (SELECT array_agg(a.attnotnull ORDER BY a.attnum)
            FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS actual_not_nulls
    FROM expected_tables e
    LEFT JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass('private.' || e.table_name)
),
expected_roles(role_name) AS (VALUES ('anon'),('authenticated'),('service_role')),
roles AS (
    SELECT e.role_name, r.oid FROM expected_roles e LEFT JOIN pg_catalog.pg_roles r ON r.rolname=e.role_name
),
expected_schemas(schema_name) AS (VALUES ('private'),('public')),
schemas AS (
    SELECT e.schema_name, n.oid FROM expected_schemas e
    LEFT JOIN pg_catalog.pg_namespace n ON n.nspname=e.schema_name
),
checks(check_id, passed, failed_status, detail) AS (
    SELECT 'schema.' || schema_name || '.exists', oid IS NOT NULL,
           'FAIL', 'Expected schema exists' FROM schemas
    UNION ALL
    SELECT 'role.' || role_name, oid IS NOT NULL, 'FAIL', 'Required role exists' FROM roles
    UNION ALL
    SELECT 'table.' || table_name || '.shape',
           oid IS NOT NULL AND relkind='r' AND actual_names=column_names
           AND actual_types=column_types AND actual_not_nulls=not_nulls,
           'FAIL', 'Exact column names, order, types and nullability' FROM tables
    UNION ALL
    SELECT 'table.' || table_name || '.rls', oid IS NOT NULL AND relrowsecurity
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid=t.oid),
           'FAIL', 'RLS enabled with no application policies' FROM tables t
    UNION ALL
    SELECT 'table.' || table_name || '.primary_key', oid IS NOT NULL AND
           (SELECT count(*)=1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=t.oid AND c.contype='p')
           AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                       JOIN pg_catalog.pg_attribute a ON a.attrelid=t.oid AND a.attname=t.primary_key
                       WHERE c.conrelid=t.oid AND c.contype='p' AND c.convalidated
                       AND c.conkey=ARRAY[a.attnum]::smallint[]),
           'FAIL', 'Validated primary key on the expected single column' FROM tables t
    UNION ALL
    SELECT 'table.' || table_name || '.user_foreign_key', oid IS NOT NULL AND
           (SELECT count(*)=1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=t.oid AND c.contype='f')
           AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                       JOIN pg_catalog.pg_attribute a ON a.attrelid=t.oid AND a.attname='user_id'
                       JOIN pg_catalog.pg_attribute u ON u.attrelid=c.confrelid AND u.attname='id'
                       WHERE c.conrelid=t.oid AND c.contype='f' AND c.convalidated AND NOT c.condeferrable
                       AND c.confrelid=pg_catalog.to_regclass('auth.users') AND c.confdeltype='c'
                       AND c.conkey=ARRAY[a.attnum]::smallint[] AND c.confkey=ARRAY[u.attnum]::smallint[]),
           'FAIL', 'Validated user_id FK to auth.users(id), ON DELETE CASCADE' FROM tables t
    UNION ALL
    SELECT 'table.' || table_name || '.defaults', oid IS NOT NULL AND
           (SELECT count(*)=1 FROM pg_catalog.pg_attrdef d WHERE d.adrelid=t.oid)
           AND EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a
                       ON a.attrelid=d.adrelid AND a.attnum=d.adnum
                       WHERE d.adrelid=t.oid AND a.attname=CASE WHEN t.table_name='admin_studio_sessions'
                           THEN 'created_at' ELSE 'revoked_at' END
                       AND pg_catalog.pg_get_expr(d.adbin,d.adrelid)='now()'),
           'FAIL', 'Only expected timestamp default now() exists' FROM tables t
    UNION ALL
    SELECT 'table.' || table_name || '.public_acl', oid IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(t.relacl,pg_catalog.acldefault('r',t.relowner))) x
                           WHERE x.grantee=0)
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a,
                           LATERAL pg_catalog.aclexplode(a.attacl) x
                           WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped AND x.grantee=0),
           'FAIL', 'PUBLIC has no table or column grants' FROM tables t
    UNION ALL
    SELECT 'table.' || t.table_name || '.role_acl.' || r.role_name,
           t.oid IS NOT NULL AND r.oid IS NOT NULL
           AND NOT pg_catalog.has_table_privilege(r.oid,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           AND NOT pg_catalog.has_any_column_privilege(r.oid,t.oid,'SELECT,INSERT,UPDATE,REFERENCES'),
           'FAIL', 'No effective table/column privileges, including inherited grants' FROM tables t CROSS JOIN roles r
    UNION ALL
    SELECT 'table.' || table_name || '.unexpected_acl', oid IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(t.relacl,pg_catalog.acldefault('r',t.relowner))) x
                           WHERE x.grantee<>t.relowner)
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a,
                           LATERAL pg_catalog.aclexplode(a.attacl) x
                           WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped AND x.grantee<>t.relowner),
           'REVIEW', 'Review non-owner grants even when browser roles remain denied' FROM tables t
    UNION ALL
    SELECT 'table.' || table_name || '.unexpected_triggers_rules', oid IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger g WHERE g.tgrelid=t.oid AND NOT g.tgisinternal)
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite r WHERE r.ev_class=t.oid),
           'REVIEW', 'Unexpected application triggers/rules require review' FROM tables t
    UNION ALL
    SELECT 'table.admin_studio_sessions.ttl_check', oid IS NOT NULL
           AND (SELECT count(*)=1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=t.oid AND c.contype='c')
           AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=t.oid AND c.contype='c'
                       AND c.convalidated AND NOT c.connoinherit
                       AND regexp_replace(pg_catalog.pg_get_expr(c.conbin,c.conrelid),'[[:space:]()]','','g') IN
                           ('expires_at>created_atANDexpires_at<=created_at+''01:00:00''::interval',
                            'expires_at>created_atANDexpires_at<=created_at+''1hour''::interval')),
           'REVIEW', 'Exactly one validated >created_at and <=created_at+1h check; inspect equivalent deparse formatting'
           FROM tables t WHERE table_name='admin_studio_sessions'
    UNION ALL
    SELECT 'table.admin_studio_revoked_sources.no_extra_checks', oid IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=t.oid AND c.contype='c'),
           'REVIEW', 'Unexpected constraints require review' FROM tables t WHERE table_name='admin_studio_revoked_sources'
    UNION ALL
    SELECT 'table.admin_studio_sessions.source_index', t.oid IS NOT NULL
           AND EXISTS (SELECT 1 FROM pg_catalog.pg_index i
                       JOIN pg_catalog.pg_class ic ON ic.oid=i.indexrelid
                       JOIN pg_catalog.pg_am am ON am.oid=ic.relam
                       WHERE i.indrelid=t.oid AND i.indisvalid AND i.indisready AND i.indislive
                       AND am.amname='btree' AND i.indpred IS NULL AND i.indexprs IS NULL
                       AND i.indnkeyatts=2 AND i.indnatts=2
                       AND (SELECT array_agg(a.attname::text ORDER BY k.ordinality)
                            FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS k(attnum,ordinality)
                            JOIN pg_catalog.pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum)
                           =ARRAY['user_id','source_session_id']),
           'FAIL', 'Valid unfiltered btree on (user_id,source_session_id)' FROM tables t WHERE table_name='admin_studio_sessions'
    UNION ALL
    SELECT 'function.' || schema_name || '.' || function_name || '.contract',
           oid IS NOT NULL AND prokind='f' AND prorettype='boolean'::regtype AND NOT proretset
           AND prosecdef=security_definer AND provolatile='v' AND lanname=language_name
           AND proargnames=argument_names AND pronargdefaults=default_count
           AND (default_count=0 OR regexp_replace(pg_catalog.pg_get_expr(proargdefaults,0),'[[:space:]]','','g')='NULL::uuid,NULL::uuid')
           AND array_length(proconfig,1)=1 AND replace(proconfig[1],'"','')='search_path=',
           'FAIL', 'Exact signature, argument names, boolean result, volatility, security, language, defaults and empty search_path'
           FROM functions
    UNION ALL
    SELECT 'function.' || schema_name || '.' || function_name || '.source_match',
           oid IS NOT NULL AND md5(prosrc)=body_md5,
           'REVIEW', 'SOURCE_MATCH: exact migration body fingerprint; mismatches require semantic review' FROM functions
    UNION ALL
    SELECT 'function.' || schema_name || '.' || function_name || '.public_acl', oid IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(f.proacl,pg_catalog.acldefault('f',f.proowner))) x
                           WHERE x.grantee=0 AND x.privilege_type='EXECUTE'),
           'FAIL', 'PUBLIC EXECUTE explicitly absent, including default ACL behavior' FROM functions f
    UNION ALL
    SELECT 'function.' || f.schema_name || '.' || f.function_name || '.role_acl.' || r.role_name,
           f.oid IS NOT NULL AND r.oid IS NOT NULL
           AND pg_catalog.has_function_privilege(r.oid,f.oid,'EXECUTE')=(r.role_name='service_role'),
           'FAIL', 'Only service_role among application roles may execute; includes inherited privileges'
           FROM functions f CROSS JOIN roles r
    UNION ALL
    SELECT 'function.' || schema_name || '.' || function_name || '.unexpected_acl', oid IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(f.proacl,pg_catalog.acldefault('f',f.proowner))) x
                           WHERE x.grantee<>f.proowner AND x.grantee<>(SELECT r.oid FROM roles r WHERE r.role_name='service_role')),
           'REVIEW', 'Review any non-owner/non-service_role function grants' FROM functions f
    UNION ALL
    SELECT 'function.' || f.schema_name || '.' || f.function_name || '.trusted_owner',
           f.oid IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM roles r WHERE r.oid IS NOT NULL AND pg_catalog.pg_has_role(r.oid,f.proowner,'MEMBER')),
           'FAIL', 'Application roles cannot assume the function owner' FROM functions f
    UNION ALL
    SELECT 'function.private.' || f.function_name || '.owner_runtime_access',
           f.oid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tables t
               LEFT JOIN pg_catalog.pg_roles o ON o.oid=f.proowner
               WHERE t.oid IS NULL OR NOT pg_catalog.has_table_privilege(f.proowner,t.oid,'SELECT')
               OR NOT pg_catalog.has_table_privilege(f.proowner,t.oid,'INSERT')
               OR NOT pg_catalog.has_table_privilege(f.proowner,t.oid,'UPDATE')
               OR NOT (o.rolsuper OR o.rolbypassrls OR (t.relowner=f.proowner AND NOT t.relforcerowsecurity)))
           AND pg_catalog.to_regclass('auth.sessions') IS NOT NULL
           AND pg_catalog.has_table_privilege(f.proowner,pg_catalog.to_regclass('auth.sessions'),'SELECT')
           AND pg_catalog.has_any_column_privilege(f.proowner,pg_catalog.to_regclass('auth.sessions'),'UPDATE'),
           'FAIL', 'Trusted definer can read/write grant tables under RLS and lock auth.sessions'
           FROM functions f WHERE schema_name='private'
    UNION ALL
    SELECT 'function.private.admin_studio_session_create.owner_delete_access',
           f.oid IS NOT NULL AND t.oid IS NOT NULL AND pg_catalog.has_table_privilege(f.proowner,t.oid,'DELETE'),
           'FAIL', 'Create RPC owner can clean expired grants' FROM functions f CROSS JOIN tables t
           WHERE f.schema_name='private' AND f.function_name='admin_studio_session_create' AND t.table_name='admin_studio_sessions'
    UNION ALL
    SELECT 'schema.private.service_role_usage',
           (SELECT r.oid IS NOT NULL AND n.oid IS NOT NULL AND pg_catalog.has_schema_privilege(r.oid,n.oid,'USAGE')
            FROM roles r CROSS JOIN schemas n WHERE r.role_name='service_role' AND n.schema_name='private'),
           'FAIL', 'service_role can reach private wrappers; does not prove Data API exposure is disabled'
    UNION ALL
    SELECT 'schema.' || n.schema_name || '.browser_create.' || r.role_name,
           r.oid IS NOT NULL AND n.oid IS NOT NULL AND NOT pg_catalog.has_schema_privilege(r.oid,n.oid,'CREATE'),
           'FAIL', 'Browser roles cannot replace or add security functions' FROM schemas n CROSS JOIN roles r
           WHERE r.role_name IN ('anon','authenticated')
    UNION ALL
    SELECT 'function.' || n.nspname || '.' || p.proname || '.extra_overload.' || p.oid::text,
           false, 'REVIEW', 'Unexpected same-name overload: ' || pg_catalog.pg_get_function_identity_arguments(p.oid)
           FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname IN ('private','public')
           AND p.proname IN (SELECT function_name FROM expected_functions)
           AND NOT EXISTS (SELECT 1 FROM functions f WHERE f.oid=p.oid)
)
SELECT check_id, CASE WHEN passed IS TRUE THEN 'PASS_CATALOG' ELSE failed_status END AS status, detail
FROM checks
UNION ALL SELECT 'boundary.postgrest_and_concurrency','NOT_RUN',
    'Catalog checks cannot prove unexposed private schema, real RPC authorization, create/revoke concurrency, or deployed runtime SHA'
ORDER BY check_id;

ROLLBACK;
