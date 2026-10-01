-- Read-only verification for 20260923_shop_flash_sale_start.sql.
-- Run only after applying that migration in the target Supabase SQL editor.
-- This file performs SELECTs only: it does not update product data, create
-- orders, alter functions, or enable guest checkout.

WITH
column_checks AS (
    SELECT
        COUNT(*) FILTER (
            WHERE table_schema = 'public'
              AND table_name = 'shop_products'
              AND column_name IN ('flash_sale_start', 'flash_sale_start_intl')
              AND data_type = 'timestamp with time zone'
        ) = 2 AS columns_ok
    FROM information_schema.columns
),
constraint_check AS (
    SELECT COALESCE(bool_and(c.convalidated), false) AS constraint_validated,
           regexp_replace(lower(pg_get_constraintdef(c.oid, false)), '[[:space:]]+', '', 'g') AS normalized_definition,
           'check((((flash_sale_startisnull)or((flash_sale_priceisnotnull)and(flash_sale_endisnotnull)and(flash_sale_start<flash_sale_end)))and((flash_sale_start_intlisnull)or((flash_sale_price_intlisnotnull)and(flash_sale_end_intlisnotnull)and(flash_sale_start_intl<flash_sale_end_intl)))))'::text AS expected_definition,
           pg_get_constraintdef(c.oid, false) AS constraint_definition
    FROM pg_constraint c
    WHERE c.conrelid = 'public.shop_products'::regclass
      AND c.conname = 'shop_products_flash_sale_window_check'
    GROUP BY c.oid
),
routine_definitions AS (
    SELECT
        pg_get_functiondef(
            'public.fn_validate_discount_code_core(uuid,uuid,character varying,integer,character varying,uuid,uuid)'::regprocedure
        ) AS preview_definition,
        pg_get_functiondef(
            'public.fn_purchase_shop_item_core(uuid,uuid,character varying,integer,character varying,uuid,uuid)'::regprocedure
        ) AS purchase_definition,
        pg_get_functiondef(
            'public.guest_shop_resolve_credit_unit_amount_with_start(text,numeric,numeric,boolean,jsonb,jsonb,jsonb,jsonb,numeric,numeric,timestamp with time zone,timestamp with time zone,integer,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure
        ) AS guest_resolver_definition,
        pg_get_functiondef(
            'public.fn_guest_shop_create_order(text,uuid,uuid,text,text,text,text,text,text,uuid,text,text,integer,integer,text)'::regprocedure
        ) AS guest_order_definition
),
guest_order_resolver_args AS (
    SELECT (regexp_match(
        guest_order_definition,
        'v_unit_amount[[:space:]]*:=[[:space:]]*public[.]guest_shop_resolve_credit_unit_amount_with_start[[:space:]]*[(]([^;]*)[)][[:space:]]*;',
        'i'
    ))[1] AS resolver_args
    FROM routine_definitions
),
guest_order_resolver_args_normalized AS (
    SELECT regexp_replace(
        lower(regexp_replace(
            resolver_args,
            E'--[^\\n]*',
            '',
            'g'
        )),
        '[[:space:]]+',
        '',
        'g'
    ) AS normalized_args
    FROM guest_order_resolver_args
),
resolver_cases AS (
    SELECT *
    FROM (VALUES
        (
            'cn_before_start_uses_tier',
            public.guest_shop_resolve_credit_unit_amount_with_start(
                'cn', 10, 10, true,
                '[{"qty":1,"price":9},{"qty":3,"price":8}]'::jsonb,
                NULL, NULL, NULL,
                7, 6,
                '2026-09-24 13:00:00+00', '2026-09-24 13:30:00+00', 3,
                '2026-09-24 11:59:59+00',
                '2026-09-24 12:00:00+00', '2026-09-24 12:30:00+00'
            ), 8::numeric
        ),
        (
            'cn_start_is_inclusive',
            public.guest_shop_resolve_credit_unit_amount_with_start(
                'cn', 10, 10, true,
                '[{"qty":1,"price":9},{"qty":3,"price":8}]'::jsonb,
                NULL, NULL, NULL,
                7, 6,
                '2026-09-24 13:00:00+00', '2026-09-24 13:30:00+00', 3,
                '2026-09-24 12:00:00+00',
                '2026-09-24 12:00:00+00', '2026-09-24 12:30:00+00'
            ), 7::numeric
        ),
        (
            'cn_end_is_exclusive',
            public.guest_shop_resolve_credit_unit_amount_with_start(
                'cn', 10, 10, true,
                '[{"qty":1,"price":9},{"qty":3,"price":8}]'::jsonb,
                NULL, NULL, NULL,
                7, 6,
                '2026-09-24 13:00:00+00', '2026-09-24 13:30:00+00', 3,
                '2026-09-24 13:00:00+00',
                '2026-09-24 12:00:00+00', '2026-09-24 12:30:00+00'
            ), 8::numeric
        ),
        (
            'null_start_preserves_immediate_flash',
            public.guest_shop_resolve_credit_unit_amount_with_start(
                'cn', 10, 10, true,
                '[{"qty":1,"price":9},{"qty":3,"price":8}]'::jsonb,
                NULL, NULL, NULL,
                7, 6,
                '2026-09-24 13:00:00+00', '2026-09-24 13:30:00+00', 3,
                '2026-09-24 11:00:00+00', NULL, NULL
            ), 7::numeric
        ),
        (
            'intl_before_own_start_uses_intl_tier',
            public.guest_shop_resolve_credit_unit_amount_with_start(
                'intl', 10, 20, true,
                '[{"qty":1,"price":9},{"qty":3,"price":8}]'::jsonb,
                '[{"qty":1,"price":9}]'::jsonb, NULL, NULL,
                7, 6,
                '2026-09-24 13:00:00+00', '2026-09-24 13:30:00+00', 3,
                '2026-09-24 12:29:59+00',
                '2026-09-24 12:00:00+00', '2026-09-24 12:30:00+00'
            ), 9::numeric
        ),
        (
            'intl_start_is_inclusive',
            public.guest_shop_resolve_credit_unit_amount_with_start(
                'intl', 10, 20, true,
                '[{"qty":1,"price":9},{"qty":3,"price":8}]'::jsonb,
                '[{"qty":1,"price":9}]'::jsonb, NULL, NULL,
                7, 6,
                '2026-09-24 13:00:00+00', '2026-09-24 13:30:00+00', 3,
                '2026-09-24 12:30:00+00',
                '2026-09-24 12:00:00+00', '2026-09-24 12:30:00+00'
            ), 6::numeric
        ),
        (
            'intl_price_only_uses_intl_tier_not_cn_flash',
            public.guest_shop_resolve_credit_unit_amount_with_start(
                'intl', 10, 20, true,
                '[{"qty":1,"price":9},{"qty":3,"price":8}]'::jsonb,
                '[{"qty":1,"price":9}]'::jsonb, NULL, NULL,
                7, 6,
                '2026-09-24 13:00:00+00', NULL, 3,
                '2026-09-24 12:45:00+00',
                '2026-09-24 12:00:00+00', '2026-09-24 12:45:00+00'
            ), 9::numeric
        ),
        (
            'intl_end_only_uses_intl_tier_not_cn_flash',
            public.guest_shop_resolve_credit_unit_amount_with_start(
                'intl', 10, 20, true,
                '[{"qty":1,"price":9},{"qty":3,"price":8}]'::jsonb,
                '[{"qty":1,"price":9}]'::jsonb, NULL, NULL,
                7, NULL,
                '2026-09-24 13:00:00+00', '2026-09-24 13:30:00+00', 3,
                '2026-09-24 12:45:00+00',
                '2026-09-24 12:00:00+00', '2026-09-24 12:30:00+00'
            ), 9::numeric
        ),
        -- Isolated resolver vector only: the validated product constraint disallows
        -- persisting INTL-start-only rows, but the resolver must still fail closed
        -- to the CN schedule if called with that incomplete INTL group.
        (
            'intl_start_alone_falls_back_to_cn_schedule',
            public.guest_shop_resolve_credit_unit_amount_with_start(
                'intl', 10, 20, true,
                '[{"qty":1,"price":9},{"qty":3,"price":8}]'::jsonb,
                '[{"qty":1,"price":9}]'::jsonb, NULL, NULL,
                7, NULL,
                '2026-09-24 13:00:00+00', NULL, 3,
                '2026-09-24 12:45:00+00',
                '2026-09-24 12:00:00+00', '2026-09-24 12:30:00+00'
            ), 7::numeric
        )
    ) AS cases(check_name, actual_amount, expected_amount)
),
checks AS (
    SELECT 'start_columns'::text AS check_name,
           COALESCE((SELECT columns_ok FROM column_checks), false) AS ok,
           'shop_products has both TIMESTAMPTZ start columns'::text AS detail
    UNION ALL
    SELECT 'validated_window_constraint',
           COALESCE((SELECT constraint_validated FROM constraint_check), false),
           COALESCE((SELECT 'convalidated=' || constraint_validated::text FROM constraint_check), 'constraint missing')
    UNION ALL
    SELECT 'window_constraint_definition',
           COALESCE((SELECT normalized_definition = expected_definition FROM constraint_check), false),
           COALESCE((SELECT format('actual=%s expected=%s', normalized_definition, expected_definition) FROM constraint_check), 'constraint missing')
    UNION ALL
    SELECT 'login_discount_preview_schedule',
           COALESCE((SELECT preview_definition ILIKE '%flash_sale_start%'
                     AND preview_definition ILIKE '%flash_sale_start_intl%'
                     AND preview_definition ILIKE '%v_effective_flash_sale_price IS NULL AND v_effective_flash_sale_end IS NULL%'
                     AND preview_definition ILIKE '%v_effective_flash_sale_start IS NULL OR v_effective_flash_sale_start <= clock_timestamp()%'
                     AND preview_definition ILIKE '%v_effective_flash_sale_end := v_product.flash_sale_end_intl%'
                     AND preview_definition ILIKE '%v_effective_flash_sale_start := v_product.flash_sale_start_intl%'
                     AND preview_definition ILIKE '%v_effective_flash_sale_price := v_product.flash_sale_price_intl%'
                     AND preview_definition ILIKE '%v_effective_flash_sale_end := v_product.flash_sale_end%'
                     AND preview_definition ILIKE '%v_effective_flash_sale_start := v_product.flash_sale_start%'
                     AND preview_definition ILIKE '%v_effective_flash_sale_price := v_product.flash_sale_price%'
                     AND preview_definition ILIKE '%v_product.flash_sale_end%'
                     FROM routine_definitions), false),
           'discount preview reads starts, gates activation, and uses the INTL group if either INTL price or end is set'
    UNION ALL
    SELECT 'login_purchase_schedule',
           COALESCE((SELECT purchase_definition ILIKE '%flash_sale_start%'
                     AND purchase_definition ILIKE '%flash_sale_start_intl%'
                     AND purchase_definition ILIKE '%v_effective_flash_sale_price IS NULL AND v_effective_flash_sale_end IS NULL%'
                     AND purchase_definition ILIKE '%v_effective_flash_sale_start IS NULL OR v_effective_flash_sale_start <= clock_timestamp()%'
                     AND purchase_definition ILIKE '%v_effective_flash_sale_end := v_product.flash_sale_end_intl%'
                     AND purchase_definition ILIKE '%v_effective_flash_sale_start := v_product.flash_sale_start_intl%'
                     AND purchase_definition ILIKE '%v_effective_flash_sale_price := v_product.flash_sale_price_intl%'
                     AND purchase_definition ILIKE '%v_effective_flash_sale_end := v_product.flash_sale_end%'
                     AND purchase_definition ILIKE '%v_effective_flash_sale_start := v_product.flash_sale_start%'
                     AND purchase_definition ILIKE '%v_effective_flash_sale_price := v_product.flash_sale_price%'
                     AND purchase_definition ILIKE '%v_product.flash_sale_end%'
                     FROM routine_definitions), false),
           'final purchase matches preview and uses the INTL group if either INTL price or end is set'
    UNION ALL
    SELECT 'guest_resolver_schedule_and_privileges',
           COALESCE((SELECT guest_resolver_definition ILIKE '%p_product_flash_sale_start%'
                     AND guest_resolver_definition ILIKE '%v_flash_start IS NULL%'
                     AND guest_resolver_definition ILIKE '%p_product_flash_sale_end_intl IS NOT NULL%'
                     AND guest_resolver_definition ILIKE '%v_has_intl_flash := p_product_flash_sale_price_intl IS NOT NULL%'
                     AND guest_resolver_definition ILIKE '%OR p_product_flash_sale_end_intl IS NOT NULL%'
                     AND has_function_privilege('service_role',
                         'public.guest_shop_resolve_credit_unit_amount_with_start(text,numeric,numeric,boolean,jsonb,jsonb,jsonb,jsonb,numeric,numeric,timestamp with time zone,timestamp with time zone,integer,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure,
                         'EXECUTE')
                     AND NOT has_function_privilege('anon',
                         'public.guest_shop_resolve_credit_unit_amount_with_start(text,numeric,numeric,boolean,jsonb,jsonb,jsonb,jsonb,numeric,numeric,timestamp with time zone,timestamp with time zone,integer,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure,
                         'EXECUTE')
                     AND NOT has_function_privilege('authenticated',
                         'public.guest_shop_resolve_credit_unit_amount_with_start(text,numeric,numeric,boolean,jsonb,jsonb,jsonb,jsonb,numeric,numeric,timestamp with time zone,timestamp with time zone,integer,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure,
                         'EXECUTE')
                     FROM routine_definitions), false),
           'resolver uses scheduled starts and is callable only through the service role'
    UNION ALL
    SELECT 'guest_order_uses_start_resolver',
           COALESCE((SELECT normalized_args =
                         'v_site,v_sku.price_points,v_sku.price_points_intl,coalesce(v_sku.is_default,false),v_sku.quantity_rules,v_sku.quantity_rules_intl,v_product.quantity_rules,v_product.quantity_rules_intl,v_product.flash_sale_price,v_product.flash_sale_price_intl,v_product.flash_sale_end,v_product.flash_sale_end_intl,v_quantity,v_now,v_product.flash_sale_start,v_product.flash_sale_start_intl'
                     FROM guest_order_resolver_args_normalized), false),
           'guest order passes the complete 16-argument resolver call in the expected order'
    UNION ALL
    SELECT check_name,
           actual_amount IS NOT DISTINCT FROM expected_amount,
           format('actual=%s expected=%s', actual_amount, expected_amount)
    FROM resolver_cases
)
SELECT check_name, ok, detail
FROM checks
ORDER BY check_name;
