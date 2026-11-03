-- Read-only provenance probe for the isolated supplier P2G database.
-- Returns database identity and object names only; it never reads business rows.
BEGIN TRANSACTION READ ONLY;

SELECT current_database() AS database_name,
    inet_server_addr() AS server_address,
    inet_server_port() AS server_port,
    current_setting('server_version') AS server_version,
    pg_postmaster_start_time() AS server_started_at;

SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
  AND table_schema IN ('public', 'auth')
ORDER BY table_schema, table_name;

SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
  AND (table_name ILIKE '%migration%' OR table_schema ILIKE '%migration%')
ORDER BY table_schema, table_name;

ROLLBACK;
