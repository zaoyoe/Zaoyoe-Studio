-- ============================================
-- Incident triage for suspicious custom redemption batches
-- Created after reviewing 2026-01-27 custom_points batches with created_by IS NULL
-- Safe by default: read-only queries first, optional containment updates are commented out
-- ============================================

WITH suspicious_batches AS (
    SELECT *
    FROM (
        VALUES
            ('1d0a91ac-241d-4a9c-bd72-e135a4a49ff2'::UUID),
            ('b334a388-ea00-4e52-9638-ec6ef9e968f3'::UUID),
            ('dc93f3cc-3ff3-4f36-acae-c3ef192b37a2'::UUID)
    ) AS t(batch_id)
)
SELECT
    rb.id,
    rb.name,
    rb.channel,
    rb.custom_points_amount,
    rb.total_count,
    rb.used_count,
    rb.status,
    rb.created_by,
    rb.site,
    rb.created_at
FROM public.redemption_batches rb
JOIN suspicious_batches sb
    ON sb.batch_id = rb.id
ORDER BY rb.created_at DESC;

WITH suspicious_batches AS (
    SELECT *
    FROM (
        VALUES
            ('1d0a91ac-241d-4a9c-bd72-e135a4a49ff2'::UUID),
            ('b334a388-ea00-4e52-9638-ec6ef9e968f3'::UUID),
            ('dc93f3cc-3ff3-4f36-acae-c3ef192b37a2'::UUID)
    ) AS t(batch_id)
)
SELECT
    rb.id AS batch_id,
    rb.name AS batch_name,
    rb.custom_points_amount,
    rc.id AS code_row_id,
    rc.code,
    rc.status AS code_status,
    rc.points_amount,
    rc.points_granted,
    rc.used_by,
    p.username,
    p.email,
    rc.used_at,
    rc.revoked_at,
    rc.revoke_reason,
    rc.external_order_id,
    rc.created_at AS code_created_at
FROM suspicious_batches sb
JOIN public.redemption_batches rb
    ON rb.id = sb.batch_id
LEFT JOIN public.redemption_codes rc
    ON rc.batch_id = rb.id
LEFT JOIN public.profiles p
    ON p.id = rc.used_by
ORDER BY rb.created_at DESC, rc.created_at DESC;

WITH suspicious_batches AS (
    SELECT *
    FROM (
        VALUES
            ('1d0a91ac-241d-4a9c-bd72-e135a4a49ff2'::UUID),
            ('b334a388-ea00-4e52-9638-ec6ef9e968f3'::UUID),
            ('dc93f3cc-3ff3-4f36-acae-c3ef192b37a2'::UUID)
    ) AS t(batch_id)
),
suspicious_codes AS (
    SELECT rc.code, rc.used_by, rc.used_at, rc.points_amount, rc.points_granted
    FROM public.redemption_codes rc
    JOIN suspicious_batches sb
        ON sb.batch_id = rc.batch_id
)
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
WHERE pl.reference_id IN (
    SELECT 'redeem_' || code
    FROM suspicious_codes
)
ORDER BY pl.created_at DESC;

WITH suspicious_batches AS (
    SELECT *
    FROM (
        VALUES
            ('1d0a91ac-241d-4a9c-bd72-e135a4a49ff2'::UUID),
            ('b334a388-ea00-4e52-9638-ec6ef9e968f3'::UUID),
            ('dc93f3cc-3ff3-4f36-acae-c3ef192b37a2'::UUID)
    ) AS t(batch_id)
)
SELECT
    rc.status,
    COUNT(*) AS code_count,
    COALESCE(SUM(COALESCE(rc.points_amount, rc.points_granted, 0)), 0) AS summed_points
FROM public.redemption_codes rc
JOIN suspicious_batches sb
    ON sb.batch_id = rc.batch_id
GROUP BY rc.status
ORDER BY rc.status;

-- Optional containment step 1:
-- Freeze the suspicious batches to stop further normal distribution workflows.
-- UPDATE public.redemption_batches
-- SET
--     status = 'frozen',
--     notes = CONCAT(COALESCE(notes, ''), CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE E'\n' END, '[2026-03-22] Security containment freeze')
-- WHERE id IN (
--     '1d0a91ac-241d-4a9c-bd72-e135a4a49ff2'::UUID,
--     'b334a388-ea00-4e52-9638-ec6ef9e968f3'::UUID,
--     'dc93f3cc-3ff3-4f36-acae-c3ef192b37a2'::UUID
-- );

-- Optional containment step 2:
-- Revoke any still-unused codes from these batches.
-- UPDATE public.redemption_codes
-- SET
--     status = 'revoked',
--     revoked_at = NOW(),
--     revoke_reason = '2026-03-22 security containment for suspicious custom batch'
-- WHERE batch_id IN (
--     '1d0a91ac-241d-4a9c-bd72-e135a4a49ff2'::UUID,
--     'b334a388-ea00-4e52-9638-ec6ef9e968f3'::UUID,
--     'dc93f3cc-3ff3-4f36-acae-c3ef192b37a2'::UUID
-- )
--   AND COALESCE(status, '') IN ('pending', 'unused', 'locked');

-- Optional containment step 3:
-- If you confirm a redeemed code was unauthorized, inspect the beneficiary first,
-- then use the existing admin deduction flow / RPC to claw back points rather than
-- doing a blind balance UPDATE here.
