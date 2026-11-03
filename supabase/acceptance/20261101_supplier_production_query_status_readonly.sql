-- Read-only check for the catalog export query submitted in the Supabase editor.
-- Run only against the verified zaoyoe main PRODUCTION project.
BEGIN TRANSACTION READ ONLY;

SELECT pid,
    state,
    round(extract(epoch FROM now() - query_start)::numeric, 1) AS runtime_seconds,
    wait_event_type,
    wait_event,
    left(query, 180) AS query_prefix
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND query ILIKE '%public_schema_catalog_export%'
ORDER BY query_start DESC;

ROLLBACK;
