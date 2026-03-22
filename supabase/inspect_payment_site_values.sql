-- Payment site anomaly preflight
-- Run this in the target project before applying 20260322_constrain_payment_sites.sql

SELECT
    'payment_checkout_sessions' AS table_name,
    COUNT(*) AS total_rows,
    COUNT(*) FILTER (WHERE site = 'cn') AS cn_rows,
    COUNT(*) FILTER (WHERE site = 'intl') AS intl_rows,
    COUNT(*) FILTER (WHERE site IS NULL OR BTRIM(site) = '') AS null_or_blank_rows,
    COUNT(*) FILTER (
        WHERE site IS NOT NULL
          AND BTRIM(site) <> ''
          AND LOWER(BTRIM(site)) NOT IN ('cn', 'intl')
    ) AS unsupported_rows
FROM public.payment_checkout_sessions

UNION ALL

SELECT
    'payment_orders' AS table_name,
    COUNT(*) AS total_rows,
    COUNT(*) FILTER (WHERE site = 'cn') AS cn_rows,
    COUNT(*) FILTER (WHERE site = 'intl') AS intl_rows,
    COUNT(*) FILTER (WHERE site IS NULL OR BTRIM(site) = '') AS null_or_blank_rows,
    COUNT(*) FILTER (
        WHERE site IS NOT NULL
          AND BTRIM(site) <> ''
          AND LOWER(BTRIM(site)) NOT IN ('cn', 'intl')
    ) AS unsupported_rows
FROM public.payment_orders;

SELECT
    id,
    site,
    provider,
    session_key,
    user_id,
    created_at
FROM public.payment_checkout_sessions
WHERE site IS NULL
   OR BTRIM(site) = ''
   OR LOWER(BTRIM(site)) NOT IN ('cn', 'intl')
ORDER BY created_at DESC
LIMIT 20;

SELECT
    id,
    site,
    provider,
    provider_order_no,
    user_id,
    created_at
FROM public.payment_orders
WHERE site IS NULL
   OR BTRIM(site) = ''
   OR LOWER(BTRIM(site)) NOT IN ('cn', 'intl')
ORDER BY created_at DESC
LIMIT 20;
