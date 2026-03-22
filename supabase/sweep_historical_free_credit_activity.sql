-- ============================================
-- Historical sweep for risky free-credit activity
-- Read-only report for:
-- - mock payment credits
-- - custom-points redemption credits
-- - beneficiary accounts
-- - day-level and user-level concentration
-- ============================================

-- 1. All mock-payment ledger credits
SELECT
    pl.created_at,
    pl.user_id,
    p.username,
    p.email,
    pl.amount,
    pl.reason,
    pl.reference_id,
    to_jsonb(pl) AS ledger_row
FROM public.points_ledger pl
LEFT JOIN public.profiles p
    ON p.id = pl.user_id
WHERE COALESCE(pl.reference_id, '') LIKE 'mock_%'
   OR COALESCE(pl.reason, '') LIKE '模拟充值:%'
ORDER BY pl.created_at DESC;

-- 2. Day-level mock credit summary
SELECT
    DATE_TRUNC('day', pl.created_at) AS day_utc,
    COUNT(*) AS entry_count,
    COUNT(DISTINCT pl.user_id) AS user_count,
    COALESCE(SUM(pl.amount), 0) AS total_amount
FROM public.points_ledger pl
WHERE COALESCE(pl.reference_id, '') LIKE 'mock_%'
   OR COALESCE(pl.reason, '') LIKE '模拟充值:%'
GROUP BY DATE_TRUNC('day', pl.created_at)
ORDER BY day_utc DESC;

-- 3. Per-user mock credit summary
SELECT
    pl.user_id,
    p.username,
    p.email,
    COUNT(*) AS mock_credit_count,
    COALESCE(SUM(pl.amount), 0) AS mock_credit_amount,
    MIN(pl.created_at) AS first_mock_credit_at,
    MAX(pl.created_at) AS last_mock_credit_at
FROM public.points_ledger pl
LEFT JOIN public.profiles p
    ON p.id = pl.user_id
WHERE COALESCE(pl.reference_id, '') LIKE 'mock_%'
   OR COALESCE(pl.reason, '') LIKE '模拟充值:%'
GROUP BY pl.user_id, p.username, p.email
ORDER BY mock_credit_amount DESC, last_mock_credit_at DESC;

-- 4. All custom-points redemption credits
SELECT
    rc.code,
    rc.used_at,
    rc.used_by AS user_id,
    p.username,
    p.email,
    rc.batch_id,
    rb.name AS batch_name,
    rb.channel,
    rb.created_by AS batch_created_by,
    rb.created_at AS batch_created_at,
    rb.custom_points_amount,
    rc.points_amount,
    rc.points_granted,
    pl.amount AS ledger_amount,
    pl.reference_id,
    to_jsonb(rc) AS redemption_code_row,
    to_jsonb(rb) AS redemption_batch_row,
    to_jsonb(pl) AS ledger_row
FROM public.redemption_codes rc
JOIN public.redemption_batches rb
    ON rb.id = rc.batch_id
LEFT JOIN public.profiles p
    ON p.id = rc.used_by
LEFT JOIN public.points_ledger pl
    ON pl.reference_id = 'redeem_' || rc.code
WHERE COALESCE(rb.custom_points_amount, 0) > 0
   OR COALESCE(pl.reason, '') LIKE '兑换码充值: 自定义积分%'
ORDER BY COALESCE(rc.used_at, pl.created_at, rb.created_at) DESC;

-- 5. Per-user custom-points redemption summary
SELECT
    rc.used_by AS user_id,
    p.username,
    p.email,
    COUNT(*) FILTER (WHERE COALESCE(rc.status, '') = 'used') AS used_code_count,
    COALESCE(SUM(COALESCE(pl.amount, rc.points_granted, rc.points_amount, 0)), 0) AS total_granted_points,
    MIN(COALESCE(rc.used_at, pl.created_at)) AS first_used_at,
    MAX(COALESCE(rc.used_at, pl.created_at)) AS last_used_at
FROM public.redemption_codes rc
JOIN public.redemption_batches rb
    ON rb.id = rc.batch_id
LEFT JOIN public.profiles p
    ON p.id = rc.used_by
LEFT JOIN public.points_ledger pl
    ON pl.reference_id = 'redeem_' || rc.code
WHERE (COALESCE(rb.custom_points_amount, 0) > 0
    OR COALESCE(pl.reason, '') LIKE '兑换码充值: 自定义积分%')
  AND rc.used_by IS NOT NULL
GROUP BY rc.used_by, p.username, p.email
ORDER BY total_granted_points DESC, last_used_at DESC;

-- 6. Non-admin accounts that received mock or custom free-credit activity
WITH active_admin_accounts AS (
    SELECT DISTINCT ar.user_id
    FROM public.admin_roles ar
    WHERE ar.expires_at IS NULL OR ar.expires_at > NOW()
),
risky_accounts AS (
    SELECT DISTINCT pl.user_id
    FROM public.points_ledger pl
    WHERE COALESCE(pl.reference_id, '') LIKE 'mock_%'
       OR COALESCE(pl.reason, '') LIKE '模拟充值:%'

    UNION

    SELECT DISTINCT rc.used_by
    FROM public.redemption_codes rc
    JOIN public.redemption_batches rb
        ON rb.id = rc.batch_id
    LEFT JOIN public.points_ledger pl
        ON pl.reference_id = 'redeem_' || rc.code
    WHERE rc.used_by IS NOT NULL
      AND (
          COALESCE(rb.custom_points_amount, 0) > 0
          OR COALESCE(pl.reason, '') LIKE '兑换码充值: 自定义积分%'
      )
)
SELECT
    ra.user_id,
    p.username,
    p.email,
    (aaa.user_id IS NOT NULL) AS is_admin_account
FROM risky_accounts ra
LEFT JOIN public.profiles p
    ON p.id = ra.user_id
LEFT JOIN active_admin_accounts aaa
    ON aaa.user_id = ra.user_id
WHERE aaa.user_id IS NULL
ORDER BY p.email NULLS LAST, p.username NULLS LAST;

-- 7. Accounts that had both mock credits and custom-points redemptions
WITH active_admin_accounts AS (
    SELECT DISTINCT ar.user_id
    FROM public.admin_roles ar
    WHERE ar.expires_at IS NULL OR ar.expires_at > NOW()
),
mock_users AS (
    SELECT DISTINCT pl.user_id
    FROM public.points_ledger pl
    WHERE COALESCE(pl.reference_id, '') LIKE 'mock_%'
       OR COALESCE(pl.reason, '') LIKE '模拟充值:%'
),
custom_users AS (
    SELECT DISTINCT rc.used_by AS user_id
    FROM public.redemption_codes rc
    JOIN public.redemption_batches rb
        ON rb.id = rc.batch_id
    LEFT JOIN public.points_ledger pl
        ON pl.reference_id = 'redeem_' || rc.code
    WHERE rc.used_by IS NOT NULL
      AND (
          COALESCE(rb.custom_points_amount, 0) > 0
          OR COALESCE(pl.reason, '') LIKE '兑换码充值: 自定义积分%'
      )
)
SELECT
    mu.user_id,
    p.username,
    p.email,
    (aaa.user_id IS NOT NULL) AS is_admin_account
FROM mock_users mu
JOIN custom_users cu
    ON cu.user_id = mu.user_id
LEFT JOIN public.profiles p
    ON p.id = mu.user_id
LEFT JOIN active_admin_accounts aaa
    ON aaa.user_id = mu.user_id
ORDER BY p.email NULLS LAST, p.username NULLS LAST;
