-- ============================================
-- Investigate admin-account activity around a suspicious redemption
-- Scope:
-- - Read-only incident review for the admin account that redeemed
--   a historically suspicious custom-points code
-- - Focus on login IPs, shared-IP accounts, admin audit trails,
--   points ledger, verification logs, payment activity, and the
--   redemption code / batch evidence chain
--
-- Defaults in this file target:
-- - email: zaoyoe@gmail.com
-- - user_id: 2e69a374-b00e-41e8-bcc4-27e055470040
-- - redeemed code: ZY-CD42-E876-656B
-- - incident timestamp (UTC): 2026-01-27 09:38:54.934808+00
--
-- Adjust the literals in incident_context if you want to reuse this
-- for another account / code / time window.
-- ============================================

-- 0. Incident context echo
WITH incident_context AS (
    SELECT
        'zaoyoe@gmail.com'::TEXT AS target_email,
        '2e69a374-b00e-41e8-bcc4-27e055470040'::UUID AS target_user_id,
        'ZY-CD42-E876-656B'::TEXT AS target_code,
        '2026-01-27 09:38:54.934808+00'::TIMESTAMPTZ AS incident_ts,
        INTERVAL '3 days' AS lookback_window,
        INTERVAL '1 day' AS lookahead_window,
        INTERVAL '30 days' AS shared_ip_window
)
SELECT
    target_email,
    target_user_id,
    target_code,
    incident_ts AS incident_ts_utc,
    incident_ts AT TIME ZONE 'Asia/Shanghai' AS incident_ts_shanghai,
    lookback_window,
    lookahead_window,
    shared_ip_window
FROM incident_context;

-- 1. Target account profile snapshot
WITH incident_context AS (
    SELECT
        'zaoyoe@gmail.com'::TEXT AS target_email,
        '2e69a374-b00e-41e8-bcc4-27e055470040'::UUID AS target_user_id
)
SELECT
    p.id,
    p.username,
    p.email,
    to_jsonb(p)->>'last_login_ip' AS last_login_ip,
    to_jsonb(p)->>'registration_ip' AS registration_ip,
    to_jsonb(p)->'registration_geo_info' AS registration_geo_info,
    to_jsonb(p) AS profile_row
FROM public.profiles p
JOIN incident_context ctx
    ON p.id = ctx.target_user_id
    OR lower(COALESCE(p.email, '')) = lower(ctx.target_email);

-- 2. Direct evidence chain for the redeemed code:
-- code row + batch row + beneficiary + matching points ledger row
WITH incident_context AS (
    SELECT
        '2e69a374-b00e-41e8-bcc4-27e055470040'::UUID AS target_user_id,
        'ZY-CD42-E876-656B'::TEXT AS target_code
)
SELECT
    rc.code,
    rc.status AS code_status,
    rc.batch_id,
    rb.name AS batch_name,
    rb.channel,
    rb.status AS batch_status,
    rb.created_by AS batch_created_by,
    rb.created_at AS batch_created_at,
    rc.points_amount,
    rc.points_granted,
    rc.used_by,
    p.username,
    p.email,
    rc.used_at,
    pl.created_at AS ledger_created_at,
    pl.amount,
    pl.reason,
    pl.reference_id,
    to_jsonb(rc) AS redemption_code_row,
    to_jsonb(rb) AS redemption_batch_row,
    to_jsonb(pl) AS ledger_row
FROM incident_context ctx
LEFT JOIN public.redemption_codes rc
    ON rc.code = ctx.target_code
LEFT JOIN public.redemption_batches rb
    ON rb.id = rc.batch_id
LEFT JOIN public.profiles p
    ON p.id = rc.used_by
LEFT JOIN public.points_ledger pl
    ON pl.reference_id = 'redeem_' || rc.code
WHERE rc.used_by = ctx.target_user_id
   OR rc.code = ctx.target_code
ORDER BY pl.created_at DESC NULLS LAST;

-- 3. Other redemption codes redeemed by this account near the incident
WITH incident_context AS (
    SELECT
        '2e69a374-b00e-41e8-bcc4-27e055470040'::UUID AS target_user_id,
        '2026-01-27 09:38:54.934808+00'::TIMESTAMPTZ AS incident_ts,
        INTERVAL '7 days' AS review_window
)
SELECT
    rc.code,
    rc.status,
    rc.batch_id,
    rb.name AS batch_name,
    rb.channel,
    rc.points_amount,
    rc.points_granted,
    rc.used_at,
    rc.created_at,
    rc.revoked_at,
    rc.revoke_reason,
    rc.external_order_id,
    to_jsonb(rc) AS redemption_code_row
FROM public.redemption_codes rc
LEFT JOIN public.redemption_batches rb
    ON rb.id = rc.batch_id
JOIN incident_context ctx
    ON rc.used_by = ctx.target_user_id
WHERE rc.used_at BETWEEN ctx.incident_ts - ctx.review_window
                     AND ctx.incident_ts + ctx.review_window
ORDER BY rc.used_at DESC, rc.created_at DESC;

-- 4. Login history around the incident
WITH incident_context AS (
    SELECT
        '2e69a374-b00e-41e8-bcc4-27e055470040'::UUID AS target_user_id,
        '2026-01-27 09:38:54.934808+00'::TIMESTAMPTZ AS incident_ts,
        INTERVAL '3 days' AS lookback_window,
        INTERVAL '1 day' AS lookahead_window
)
SELECT
    ulh.created_at,
    ulh.ip_address::TEXT AS ip_address,
    ulh.user_agent,
    to_jsonb(ulh)->'geo_info' AS geo_info,
    to_jsonb(ulh)->>'site' AS site,
    to_jsonb(ulh) AS login_history_row
FROM public.user_login_history ulh
JOIN incident_context ctx
    ON ulh.user_id = ctx.target_user_id
WHERE ulh.created_at BETWEEN ctx.incident_ts - ctx.lookback_window
                         AND ctx.incident_ts + ctx.lookahead_window
ORDER BY ulh.created_at DESC;

-- 5. Shared-IP correlation:
-- accounts that used the same IP(s) as the target account near the incident
WITH incident_context AS (
    SELECT
        '2e69a374-b00e-41e8-bcc4-27e055470040'::UUID AS target_user_id,
        '2026-01-27 09:38:54.934808+00'::TIMESTAMPTZ AS incident_ts,
        INTERVAL '30 days' AS shared_ip_window
),
target_ips AS (
    SELECT DISTINCT ulh.ip_address
    FROM public.user_login_history ulh
    JOIN incident_context ctx
        ON ulh.user_id = ctx.target_user_id
    WHERE ulh.created_at BETWEEN ctx.incident_ts - ctx.shared_ip_window
                             AND ctx.incident_ts + ctx.shared_ip_window
),
shared_accounts AS (
    SELECT
        ulh.user_id,
        ulh.ip_address::TEXT AS ip_address,
        COUNT(*) AS login_count,
        MIN(ulh.created_at) AS first_seen_at,
        MAX(ulh.created_at) AS last_seen_at
    FROM public.user_login_history ulh
    JOIN target_ips tip
        ON tip.ip_address = ulh.ip_address
    GROUP BY ulh.user_id, ulh.ip_address
)
SELECT
    sa.user_id,
    p.username,
    p.email,
    sa.ip_address,
    sa.login_count,
    sa.first_seen_at,
    sa.last_seen_at
FROM shared_accounts sa
LEFT JOIN public.profiles p
    ON p.id = sa.user_id
JOIN incident_context ctx
    ON sa.user_id <> ctx.target_user_id
ORDER BY sa.last_seen_at DESC, sa.login_count DESC;

-- 6. Admin audit trails involving this admin account
WITH incident_context AS (
    SELECT
        '2e69a374-b00e-41e8-bcc4-27e055470040'::UUID AS target_user_id,
        '2026-01-27 09:38:54.934808+00'::TIMESTAMPTZ AS incident_ts,
        INTERVAL '7 days' AS review_window
),
new_audit_logs AS (
    SELECT
        'admin_audit_logs'::TEXT AS source_table,
        l.created_at,
        l.admin_id,
        ap.username AS admin_username,
        ap.email AS admin_email,
        l.target_user_id,
        tp.username AS target_username,
        tp.email AS target_email,
        l.action_type AS action_name,
        l.details
    FROM public.admin_audit_logs l
    LEFT JOIN public.profiles ap
        ON ap.id = l.admin_id
    LEFT JOIN public.profiles tp
        ON tp.id = l.target_user_id
    JOIN incident_context ctx
        ON l.admin_id = ctx.target_user_id
        OR l.target_user_id = ctx.target_user_id
    WHERE l.created_at BETWEEN ctx.incident_ts - ctx.review_window
                           AND ctx.incident_ts + ctx.review_window
),
legacy_audit_logs AS (
    SELECT
        'admin_audit_log'::TEXT AS source_table,
        l.created_at,
        l.admin_id,
        ap.username AS admin_username,
        ap.email AS admin_email,
        l.target_user_id,
        tp.username AS target_username,
        tp.email AS target_email,
        l.action AS action_name,
        l.details
    FROM public.admin_audit_log l
    LEFT JOIN public.profiles ap
        ON ap.id = l.admin_id
    LEFT JOIN public.profiles tp
        ON tp.id = l.target_user_id
    JOIN incident_context ctx
        ON l.admin_id = ctx.target_user_id
        OR l.target_user_id = ctx.target_user_id
    WHERE l.created_at BETWEEN ctx.incident_ts - ctx.review_window
                           AND ctx.incident_ts + ctx.review_window
)
SELECT *
FROM (
    SELECT * FROM new_audit_logs
    UNION ALL
    SELECT * FROM legacy_audit_logs
) audit_union
ORDER BY created_at DESC;

-- 7. Points ledger around the incident
WITH incident_context AS (
    SELECT
        '2e69a374-b00e-41e8-bcc4-27e055470040'::UUID AS target_user_id,
        '2026-01-27 09:38:54.934808+00'::TIMESTAMPTZ AS incident_ts,
        INTERVAL '7 days' AS review_window
)
SELECT
    pl.created_at,
    pl.amount,
    pl.reason,
    pl.reference_id,
    to_jsonb(pl) AS ledger_row
FROM public.points_ledger pl
JOIN incident_context ctx
    ON pl.user_id = ctx.target_user_id
WHERE pl.created_at BETWEEN ctx.incident_ts - ctx.review_window
                        AND ctx.incident_ts + ctx.review_window
ORDER BY pl.created_at DESC;

-- 8. Verification logs around the incident
WITH incident_context AS (
    SELECT
        '2e69a374-b00e-41e8-bcc4-27e055470040'::UUID AS target_user_id,
        '2026-01-27 09:38:54.934808+00'::TIMESTAMPTZ AS incident_ts,
        INTERVAL '7 days' AS review_window
)
SELECT
    vl.created_at,
    to_jsonb(vl)->>'verification_id' AS verification_id,
    to_jsonb(vl)->>'status' AS status,
    to_jsonb(vl)->>'message' AS message,
    to_jsonb(vl) AS verification_log_row
FROM public.verification_logs vl
JOIN incident_context ctx
    ON vl.user_id = ctx.target_user_id
WHERE vl.created_at BETWEEN ctx.incident_ts - ctx.review_window
                        AND ctx.incident_ts + ctx.review_window
ORDER BY vl.created_at DESC;

-- 9. Payment orders for this account around the incident
WITH incident_context AS (
    SELECT
        '2e69a374-b00e-41e8-bcc4-27e055470040'::UUID AS target_user_id,
        '2026-01-27 09:38:54.934808+00'::TIMESTAMPTZ AS incident_ts,
        INTERVAL '7 days' AS review_window
)
SELECT
    po.id,
    po.provider,
    po.provider_order_no,
    po.package_name,
    po.expected_amount,
    po.paid_amount,
    po.points_amount,
    po.status,
    po.sign_verified,
    po.amount_verified,
    po.created_at,
    po.paid_at,
    po.verified_at,
    po.claimed_at,
    po.redemption_code,
    to_jsonb(po) AS payment_order_row
FROM public.payment_orders po
JOIN incident_context ctx
    ON po.user_id = ctx.target_user_id
WHERE po.created_at BETWEEN ctx.incident_ts - ctx.review_window
                        AND ctx.incident_ts + ctx.review_window
ORDER BY po.created_at DESC;

-- 10. Payment events related to this account's payment orders
WITH incident_context AS (
    SELECT
        '2e69a374-b00e-41e8-bcc4-27e055470040'::UUID AS target_user_id,
        '2026-01-27 09:38:54.934808+00'::TIMESTAMPTZ AS incident_ts,
        INTERVAL '7 days' AS review_window
),
target_orders AS (
    SELECT po.id
    FROM public.payment_orders po
    JOIN incident_context ctx
        ON po.user_id = ctx.target_user_id
    WHERE po.created_at BETWEEN ctx.incident_ts - ctx.review_window
                            AND ctx.incident_ts + ctx.review_window
)
SELECT
    pe.created_at,
    pe.provider,
    pe.provider_order_no,
    pe.event_type,
    pe.signature_valid,
    pe.amount_valid,
    pe.processing_result,
    pe.error_message,
    pe.response_status,
    to_jsonb(pe) AS payment_event_row
FROM public.payment_events pe
JOIN target_orders o
    ON o.id = pe.payment_order_id
ORDER BY pe.created_at DESC;

-- 11. Payment query attempts around the incident
WITH incident_context AS (
    SELECT
        '2e69a374-b00e-41e8-bcc4-27e055470040'::UUID AS target_user_id,
        '2026-01-27 09:38:54.934808+00'::TIMESTAMPTZ AS incident_ts,
        INTERVAL '7 days' AS review_window
)
SELECT
    pqa.created_at,
    pqa.provider,
    pqa.site,
    pqa.order_no,
    pqa.success,
    pqa.response_status,
    pqa.outcome_code,
    pqa.message,
    pqa.payment_order_id,
    pqa.checkout_session_id,
    to_jsonb(pqa) AS payment_query_attempt_row
FROM public.payment_query_attempts pqa
JOIN incident_context ctx
    ON pqa.user_id = ctx.target_user_id
WHERE pqa.created_at BETWEEN ctx.incident_ts - ctx.review_window
                         AND ctx.incident_ts + ctx.review_window
ORDER BY pqa.created_at DESC;
