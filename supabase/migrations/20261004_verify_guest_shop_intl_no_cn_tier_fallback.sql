-- ===========================================================================
-- Verification script for 20261004_guest_shop_intl_no_cn_tier_fallback.sql
-- ===========================================================================
-- Read-only verification. Run in Supabase SQL editor after applying migration.
-- ===========================================================================

WITH tests AS (
    SELECT
        -- Test 1: INTL with CN quantity rules present but INTL quantity rules NULL: must return base price 10, NOT 0.10
        public.guest_shop_resolve_credit_unit_amount_with_start(
            'intl',
            10::numeric,
            10::numeric,
            false,
            '[{"qty":1,"price":0.10},{"qty":3,"price":0.08}]'::jsonb,
            NULL::jsonb,
            NULL::jsonb,
            NULL::jsonb,
            NULL::numeric,
            NULL::numeric,
            NULL::timestamptz,
            NULL::timestamptz,
            1::integer,
            clock_timestamp(),
            NULL::timestamptz,
            NULL::timestamptz
        ) AS intl_no_cn_fallback_result,

        -- Test 2: INTL with own quantity rules: must apply INTL quantity rule (8.00)
        public.guest_shop_resolve_credit_unit_amount_with_start(
            'intl',
            10::numeric,
            10::numeric,
            false,
            '[{"qty":1,"price":0.10}]'::jsonb,
            '[{"qty":1,"price":8.00}]'::jsonb,
            NULL::jsonb,
            NULL::jsonb,
            NULL::numeric,
            NULL::numeric,
            NULL::timestamptz,
            NULL::timestamptz,
            1::integer,
            clock_timestamp(),
            NULL::timestamptz,
            NULL::timestamptz
        ) AS intl_own_rules_result,

        -- Test 3: CN site with CN quantity rules: must continue to apply CN quantity rule (0.10)
        public.guest_shop_resolve_credit_unit_amount_with_start(
            'cn',
            10::numeric,
            NULL::numeric,
            false,
            '[{"qty":1,"price":0.10}]'::jsonb,
            NULL::jsonb,
            NULL::jsonb,
            NULL::jsonb,
            NULL::numeric,
            NULL::numeric,
            NULL::timestamptz,
            NULL::timestamptz,
            1::integer,
            clock_timestamp(),
            NULL::timestamptz,
            NULL::timestamptz
        ) AS cn_quantity_rules_result
)
SELECT
    intl_no_cn_fallback_result,
    CASE WHEN intl_no_cn_fallback_result = 10.00 THEN 'PASS' ELSE 'FAIL' END AS test1_status,
    intl_own_rules_result,
    CASE WHEN intl_own_rules_result = 8.00 THEN 'PASS' ELSE 'FAIL' END AS test2_status,
    cn_quantity_rules_result,
    CASE WHEN cn_quantity_rules_result = 0.10 THEN 'PASS' ELSE 'FAIL' END AS test3_status
FROM tests;
