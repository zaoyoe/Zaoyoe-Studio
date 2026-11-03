-- Read-only provenance for the matching application/database migration chain.
-- This returns migration version/name metadata only, never business rows.
BEGIN TRANSACTION READ ONLY;

SELECT jsonb_pretty(jsonb_build_object(
    'capture', jsonb_build_object(
        'database', current_database(),
        'server_version', current_setting('server_version'),
        'ledger', 'supabase_migrations.schema_migrations'
    ),
    'applied_migration_count', COUNT(*),
    'first_version', MIN(version),
    'last_version', MAX(version),
    'applied_migrations', COALESCE(
        jsonb_agg(jsonb_build_object('version', version, 'name', name) ORDER BY version),
        '[]'::jsonb
    )
)) AS remote_migration_ledger
FROM supabase_migrations.schema_migrations;

ROLLBACK;
