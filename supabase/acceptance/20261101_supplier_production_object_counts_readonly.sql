-- Read-only size probe for planning a complete production schema catalog export.
-- Run only against the verified zaoyoe main PRODUCTION project.
-- Reads PostgreSQL catalogs only; it does not read application rows or write data.
SELECT 'relations' AS object_group, c.relkind::text AS object_kind,
       count(*)::bigint AS object_count
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
GROUP BY c.relkind
UNION ALL
SELECT 'routines', p.prokind::text, count(*)::bigint
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p', 'w')
GROUP BY p.prokind
UNION ALL
SELECT 'types', t.typtype::text, count(*)::bigint
FROM pg_type AS t
JOIN pg_namespace AS n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
  AND t.typtype IN ('d', 'e', 'c', 'r', 'm')
GROUP BY t.typtype
ORDER BY object_group, object_kind;
