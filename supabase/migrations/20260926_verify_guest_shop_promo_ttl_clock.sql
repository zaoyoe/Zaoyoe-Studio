-- Read-only verification for 20260926_guest_shop_promo_ttl_clock.sql.
-- Codex does not execute this file. The whole file is one SELECT and returns
-- three rows. Paste all three back. Do not create an order from this result.
--
-- created_at_default = false with detail now() means the ALTER has not been
-- applied yet. Run the migration, then run this file again. That is not a
-- failure of this script.

WITH fn AS (
    SELECT p.oid,
           pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_guest_shop_create_order'
),
fn_count AS (
    SELECT COUNT(*)::INTEGER AS n FROM fn
),
live AS (
    SELECT def
    FROM fn
    WHERE oid = to_regprocedure($sig$public.fn_guest_shop_create_order(text,uuid,uuid,text,text,text,text,text,text,uuid,text,text,integer,integer,text)$sig$)
),
insert_cols AS (
    SELECT substring(
        def
        FROM $re$INSERT INTO public\.guest_shop_orders[[:space:]]*\(([^)]*)\)[[:space:]]*VALUES$re$
    ) AS cols
    FROM live
),
coldef AS (
    SELECT pg_get_expr(ad.adbin, ad.adrelid) AS expr,
           a.attnotnull,
           a.atttypid
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef ad
        ON ad.adrelid = a.attrelid
       AND ad.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relname = 'guest_shop_orders'
      AND a.attname = 'created_at'
      AND a.attnum > 0
      AND NOT a.attisdropped
),
checks AS (
    SELECT 'created_at_default'::TEXT AS check_name,
           1 AS ord,
           COALESCE((
               SELECT expr = 'clock_timestamp()'
                  AND attnotnull
                  AND atttypid = 'timestamptz'::regtype
               FROM coldef
           ), false) AS ok,
           COALESCE((SELECT expr FROM coldef), '<missing>') AS detail
    UNION ALL
    SELECT 'create_order_omits_created_at',
           2,
           COALESCE((SELECT n FROM fn_count), 0) = 1
           AND COALESCE((
               SELECT cols IS NOT NULL
                  AND cols !~ $created_at$(^|[^[:alnum:]_])created_at([^[:alnum:]_]|$)$created_at$
               FROM insert_cols
           ), false) AS ok,
           CASE
               WHEN COALESCE((SELECT n FROM fn_count), 0) <> 1
                   THEN 'create_order overloads=' || COALESCE((SELECT n FROM fn_count), 0)::TEXT
               WHEN NOT EXISTS (SELECT 1 FROM insert_cols WHERE cols IS NOT NULL)
                   THEN '15-arg INSERT column list not found'
               ELSE '15-arg INSERT omits created_at'
           END AS detail
    UNION ALL
    SELECT 'create_order_uses_clock_timestamp',
           3,
           COALESCE((
               SELECT def ~ $re$v_now[[:space:]]+TIMESTAMPTZ[[:space:]]*:=[[:space:]]*clock_timestamp[[:space:]]*\($re$
                  AND def ~ $re$v_expires_at[[:space:]]*:=[[:space:]]*v_now[[:space:]]*\+[[:space:]]*make_interval\(secs[[:space:]]*=>[[:space:]]*p_ttl_seconds\)$re$
               FROM live
           ), false) AS ok,
           CASE
               WHEN NOT EXISTS (SELECT 1 FROM live) THEN '15-arg function missing'
               ELSE 'v_now is clock_timestamp and expires_at adds p_ttl_seconds'
           END AS detail
)
SELECT check_name, ok, detail
FROM checks
ORDER BY ord;
