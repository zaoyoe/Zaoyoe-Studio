-- ============================================
-- Contain suspicious custom redemption batches
-- Scope:
-- - Freeze the three suspicious batches discovered on 2026-01-27
-- - Revoke any still-unused / locked codes in those batches
-- - Show the remaining used code(s) for manual follow-up
-- ============================================

BEGIN;

-- 1. Freeze the suspicious batches to stop further operational use.
UPDATE public.redemption_batches
SET status = 'frozen'
WHERE id IN (
    '1d0a91ac-241d-4a9c-bd72-e135a4a49ff2'::UUID,
    'b334a388-ea00-4e52-9638-ec6ef9e968f3'::UUID,
    'dc93f3cc-3ff3-4f36-acae-c3ef192b37a2'::UUID
);

-- 2. Revoke codes that are still available to redeem.
UPDATE public.redemption_codes
SET
    status = 'revoked',
    revoked_at = NOW(),
    revoke_reason = '2026-03-22 security containment for suspicious custom-point batch'
WHERE batch_id IN (
    '1d0a91ac-241d-4a9c-bd72-e135a4a49ff2'::UUID,
    'b334a388-ea00-4e52-9638-ec6ef9e968f3'::UUID,
    'dc93f3cc-3ff3-4f36-acae-c3ef192b37a2'::UUID
)
  AND COALESCE(status, '') IN ('pending', 'unused', 'locked');

COMMIT;

-- 3. Verification: the only remaining code(s) in these batches should already be used/revoked.
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
    rb.status AS batch_status,
    rc.code,
    rc.status AS code_status,
    rc.points_amount,
    rc.points_granted,
    rc.used_by,
    p.username,
    p.email,
    rc.used_at,
    rc.revoked_at,
    rc.revoke_reason
FROM suspicious_batches sb
JOIN public.redemption_batches rb
    ON rb.id = sb.batch_id
LEFT JOIN public.redemption_codes rc
    ON rc.batch_id = rb.id
LEFT JOIN public.profiles p
    ON p.id = rc.used_by
ORDER BY rb.created_at DESC, rc.created_at DESC;

-- 4. Manual follow-up for the already-used code(s): inspect beneficiary and ledger.
WITH suspicious_batches AS (
    SELECT *
    FROM (
        VALUES
            ('1d0a91ac-241d-4a9c-bd72-e135a4a49ff2'::UUID),
            ('b334a388-ea00-4e52-9638-ec6ef9e968f3'::UUID),
            ('dc93f3cc-3ff3-4f36-acae-c3ef192b37a2'::UUID)
    ) AS t(batch_id)
),
used_codes AS (
    SELECT rc.code, rc.used_by, rc.used_at, COALESCE(rc.points_granted, rc.points_amount, 0) AS effective_points
    FROM public.redemption_codes rc
    JOIN suspicious_batches sb
        ON sb.batch_id = rc.batch_id
    WHERE COALESCE(rc.status, '') = 'used'
)
SELECT
    uc.code,
    uc.used_by,
    p.username,
    p.email,
    uc.used_at,
    uc.effective_points,
    pl.created_at AS ledger_created_at,
    pl.amount,
    pl.reason,
    pl.reference_id,
    to_jsonb(pl) AS ledger_row
FROM used_codes uc
LEFT JOIN public.profiles p
    ON p.id = uc.used_by
LEFT JOIN public.points_ledger pl
    ON pl.reference_id = 'redeem_' || uc.code
ORDER BY uc.used_at DESC, pl.created_at DESC;
