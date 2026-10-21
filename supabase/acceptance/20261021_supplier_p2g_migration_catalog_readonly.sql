BEGIN TRANSACTION READ ONLY;

SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
  AND (table_name ILIKE '%migration%' OR table_schema ILIKE '%migration%')
ORDER BY table_schema, table_name;

ROLLBACK;
