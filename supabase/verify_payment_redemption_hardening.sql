-- ============================================
-- Verify payment / redemption hardening after 2026-03-22 security fixes
-- Run in Supabase SQL Editor against the target environment
-- ============================================

-- 1. Function presence / grants / guardrails
WITH function_targets AS (
    SELECT *
    FROM (
        VALUES
            ('public.fn_purchase_shop_item(uuid,uuid)'::TEXT, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, 'legacy 2-arg overload should be dropped'),
            ('public.fn_dispatch_code(character varying,character varying)'::TEXT, TRUE, FALSE, FALSE, TRUE, FALSE, FALSE, 'legacy dispatch RPC should be service_role only'),
            ('public.fn_ensure_redemption_code_for_payment_order(uuid,uuid,integer,character varying,text)'::TEXT, TRUE, TRUE, FALSE, TRUE, TRUE, TRUE, 'mint-code RPC should require admin/service_role and paid gate'),
            ('public.fn_apply_payment_order_review(uuid,text,text,uuid)'::TEXT, TRUE, TRUE, FALSE, TRUE, TRUE, FALSE, 'manual review RPC should enforce admin/service_role'),
            ('public.fn_generate_codes(character varying,uuid,integer,character varying,timestamp with time zone,character varying)'::TEXT, TRUE, TRUE, FALSE, FALSE, TRUE, FALSE, 'package code generation should stay admin-gated'),
            ('public.fn_generate_custom_codes(text,integer,integer,text,timestamp with time zone,character varying)'::TEXT, TRUE, TRUE, FALSE, FALSE, TRUE, FALSE, 'custom code generation should stay admin-gated'),
            ('public.fn_generate_custom_codes(text,integer,integer,text,timestamp with time zone)'::TEXT, TRUE, TRUE, FALSE, FALSE, FALSE, FALSE, 'legacy wrapper should exist only as a delegator')
    ) AS t(
        signature,
        expect_exists,
        expect_authenticated_execute,
        expect_anon_execute,
        expect_service_role_execute,
        expect_admin_gate,
        expect_paid_gate,
        note
    )
),
resolved AS (
    SELECT
        ft.*,
        to_regprocedure(ft.signature) AS proc_oid
    FROM function_targets ft
),
checks AS (
    SELECT
        signature,
        note,
        proc_oid IS NOT NULL AS exists_now,
        COALESCE(has_function_privilege('authenticated', proc_oid, 'EXECUTE'), FALSE) AS authenticated_can_execute,
        COALESCE(has_function_privilege('anon', proc_oid, 'EXECUTE'), FALSE) AS anon_can_execute,
        COALESCE(has_function_privilege('service_role', proc_oid, 'EXECUTE'), FALSE) AS service_role_can_execute,
        CASE
            WHEN proc_oid IS NULL THEN NULL
            ELSE (
                pg_get_functiondef(proc_oid::OID) ILIKE '%public.is_admin()%'
                OR pg_get_functiondef(proc_oid::OID) ILIKE '%admin or service_role only%'
                OR pg_get_functiondef(proc_oid::OID) ILIKE '%Admin only%'
            )
        END AS admin_gate_present,
        CASE
            WHEN proc_oid IS NULL THEN NULL
            ELSE (
                pg_get_functiondef(proc_oid::OID) ILIKE '%payment order must be paid before issuing redemption code%'
                OR pg_get_functiondef(proc_oid::OID) ILIKE '%v_normalized_status NOT IN (''paid'', ''redeemed'')%'
            )
        END AS paid_gate_present,
        expect_exists,
        expect_authenticated_execute,
        expect_anon_execute,
        expect_service_role_execute,
        expect_admin_gate,
        expect_paid_gate
    FROM resolved
)
SELECT
    signature,
    note,
    exists_now,
    authenticated_can_execute,
    anon_can_execute,
    service_role_can_execute,
    admin_gate_present,
    paid_gate_present,
    CASE
        WHEN exists_now IS DISTINCT FROM expect_exists THEN 'FAIL'
        WHEN authenticated_can_execute IS DISTINCT FROM expect_authenticated_execute THEN 'FAIL'
        WHEN anon_can_execute IS DISTINCT FROM expect_anon_execute THEN 'FAIL'
        WHEN service_role_can_execute IS DISTINCT FROM expect_service_role_execute THEN 'FAIL'
        WHEN expect_admin_gate AND admin_gate_present IS DISTINCT FROM TRUE THEN 'FAIL'
        WHEN expect_paid_gate AND paid_gate_present IS DISTINCT FROM TRUE THEN 'FAIL'
        ELSE 'PASS'
    END AS verification_status
FROM checks
ORDER BY signature;

-- 2. Any payment orders that already have a redemption code before reaching paid/redeemed?
SELECT
    id,
    provider,
    provider_order_no,
    status,
    sign_verified,
    amount_verified,
    points_amount,
    redemption_code,
    user_id,
    created_at,
    updated_at
FROM public.payment_orders
WHERE redemption_code IS NOT NULL
  AND COALESCE(LOWER(status), '') NOT IN ('paid', 'redeemed')
ORDER BY updated_at DESC NULLS LAST, created_at DESC
LIMIT 200;

-- 3. Any codes already linked to unresolved / unverified payment orders?
SELECT
    po.id AS payment_order_id,
    po.provider,
    po.provider_order_no,
    po.status AS payment_status,
    po.sign_verified,
    po.amount_verified,
    po.redemption_code,
    rc.status AS code_status,
    rc.used_by,
    rc.used_at,
    rc.external_order_id,
    po.created_at
FROM public.payment_orders po
JOIN public.redemption_codes rc
    ON rc.code = po.redemption_code
WHERE po.redemption_code IS NOT NULL
  AND (
        COALESCE(LOWER(po.status), '') NOT IN ('paid', 'redeemed')
        OR NOT COALESCE(po.sign_verified, FALSE)
        OR NOT COALESCE(po.amount_verified, FALSE)
      )
ORDER BY po.created_at DESC
LIMIT 200;

-- 4. Any redemption codes linked to synthetic pending provider order numbers?
SELECT
    code,
    status,
    external_order_id,
    used_by,
    used_at,
    created_at
FROM public.redemption_codes
WHERE COALESCE(external_order_id, '') LIKE 'PENDING\_%' ESCAPE '\'
ORDER BY created_at DESC
LIMIT 200;

-- 5. Recent custom-code batches with missing creator identity (worth a manual look)
SELECT
    id,
    name,
    channel,
    custom_points_amount,
    total_count,
    used_count,
    created_by,
    site,
    created_at
FROM public.redemption_batches
WHERE package_id IS NULL
  AND COALESCE(custom_points_amount, 0) > 0
ORDER BY created_at DESC
LIMIT 100;
