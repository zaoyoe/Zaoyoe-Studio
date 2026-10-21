BEGIN TRANSACTION READ ONLY;

SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version;

ROLLBACK;
