-- Verify guest-shop credit-price settlement.
-- Codex does not execute this file. Run it in the target Supabase SQL editor
-- after 20260915_guest_shop_credit_pricing.sql. This script is read-only: it
-- does not enable guest products, does not mutate orders, and does not rollback
-- 20260913/20260914.
-- Constraint matching must accept PostgreSQL canonical CHECK dumps such as
-- CHECK (((currency)::text = 'CNY'::text)), not only the source SQL form.

WITH expected_functions AS (
    SELECT *
    FROM (
        VALUES
            (
                'guest_shop_resolve_credit_unit_amount',
                'text, numeric, numeric, boolean, jsonb, jsonb, jsonb, jsonb, numeric, numeric, timestamp with time zone, timestamp with time zone, integer, timestamp with time zone',
                false,
                'search_path=public, pg_temp'
            ),
            (
                'fn_guest_shop_create_order',
                'text, uuid, uuid, text, text, text, text, text, text, text, text, integer',
                true,
                'search_path=public, pg_temp'
            )
    ) AS t(function_name, identity_args, requires_definer, expected_config)
), function_rows AS (
    SELECT
        e.function_name,
        e.identity_args,
        e.requires_definer,
        (p.oid IS NOT NULL) AS present,
        COALESCE(p.prosecdef, false) AS security_definer,
        COALESCE(p.provolatile, '') AS provolatile,
        EXISTS (
            SELECT 1
            FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) cfg
            WHERE cfg = e.expected_config
        ) AS search_path_pinned
    FROM expected_functions e
    LEFT JOIN pg_proc p
      ON p.oid = to_regprocedure(
          format('public.%I(%s)', e.function_name, e.identity_args)
      )::OID
), grant_rows AS (
    SELECT
        e.function_name,
        e.identity_args,
        CASE
            WHEN p.oid IS NULL THEN false
            ELSE EXISTS (
                SELECT 1
                FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
                JOIN pg_roles r ON r.oid = g.grantee
                WHERE r.rolname = 'service_role'
                  AND g.privilege_type = 'EXECUTE'
            )
        END AS service_role_execute,
        CASE
            WHEN p.oid IS NULL THEN false
            ELSE EXISTS (
                SELECT 1
                FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
                JOIN pg_roles r ON r.oid = g.grantee
                WHERE r.rolname = 'anon'
                  AND g.privilege_type = 'EXECUTE'
            )
        END AS anon_execute,
        CASE
            WHEN p.oid IS NULL THEN false
            ELSE EXISTS (
                SELECT 1
                FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
                JOIN pg_roles r ON r.oid = g.grantee
                WHERE r.rolname = 'authenticated'
                  AND g.privilege_type = 'EXECUTE'
            )
        END AS authenticated_execute,
        CASE
            WHEN p.oid IS NULL THEN false
            ELSE EXISTS (
                SELECT 1
                FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) g
                WHERE g.grantee = 0
                  AND g.privilege_type = 'EXECUTE'
            )
        END AS public_execute
    FROM expected_functions e
    LEFT JOIN pg_proc p
      ON p.oid = to_regprocedure(
          format('public.%I(%s)', e.function_name, e.identity_args)
      )::OID
), create_order_def AS (
    SELECT pg_get_functiondef(
        to_regprocedure(
            'public.fn_guest_shop_create_order(text, uuid, uuid, text, text, text, text, text, text, text, text, integer)'
        )::OID
    ) AS def
), helper_def AS (
    SELECT pg_get_functiondef(
        to_regprocedure(
            'public.guest_shop_resolve_credit_unit_amount(text, numeric, numeric, boolean, jsonb, jsonb, jsonb, jsonb, numeric, numeric, timestamp with time zone, timestamp with time zone, integer, timestamp with time zone)'
        )::OID
    ) AS def
), leftover_cash_columns AS (
    SELECT COUNT(*)::INT AS present_count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
            (table_name = 'shop_products' AND column_name IN ('guest_cash_price_cny', 'guest_cash_price_intl'))
         OR (table_name = 'shop_product_skus' AND column_name IN ('guest_cash_price_cny', 'guest_cash_price_intl'))
      )
), currency_constraints AS (
    SELECT
        c.conrelid::regclass::TEXT AS table_name,
        c.conname,
        pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    WHERE c.contype = 'c'
      AND c.conrelid IN (
          'public.guest_shop_orders'::regclass,
          'public.guest_shop_payment_orders'::regclass,
          'public.guest_shop_payment_events'::regclass
      )
      AND c.conname IN (
          'guest_shop_orders_currency_check',
          'guest_shop_orders_site_currency_check',
          'guest_shop_payment_orders_currency_check',
          'guest_shop_payment_orders_site_currency_check',
          'guest_shop_payment_events_observed_currency_check'
      )
), currency_defs AS (
    SELECT COALESCE(jsonb_object_agg(conname, def), '{}'::JSONB) AS defs
    FROM currency_constraints
), leftover_non_cny AS (
    SELECT
        (SELECT COUNT(*) FROM public.guest_shop_orders WHERE currency IS DISTINCT FROM 'CNY') AS orders,
        (SELECT COUNT(*) FROM public.guest_shop_payment_orders WHERE currency IS DISTINCT FROM 'CNY') AS payments
), enabled_products AS (
    SELECT COUNT(*) AS enabled_count
    FROM public.shop_products
    WHERE allow_guest_purchase IS TRUE
), checks AS (
    SELECT
        1 AS sort_order,
        'credit_pricing_functions'::TEXT AS check_name,
        COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'function_name', function_name,
                    'present', present,
                    'security_definer', security_definer,
                    'requires_definer', requires_definer,
                    'provolatile', provolatile,
                    'search_path_pinned', search_path_pinned
                )
                ORDER BY function_name
            )
            FROM function_rows
        ), '[]'::JSONB) AS observed,
        to_jsonb('helper STABLE invoker; create-order SECURITY DEFINER; both pin search_path'::TEXT) AS expected

    UNION ALL

    SELECT
        2,
        'credit_pricing_grants',
        COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'function_name', function_name,
                    'service_role_execute', service_role_execute,
                    'anon_execute', anon_execute,
                    'authenticated_execute', authenticated_execute,
                    'public_execute', public_execute
                )
                ORDER BY function_name
            )
            FROM grant_rows
        ), '[]'::JSONB),
        to_jsonb('service_role execute only'::TEXT)

    UNION ALL

    SELECT
        3,
        'create_order_credit_price_body',
        jsonb_build_object(
            'present', (SELECT def IS NOT NULL FROM create_order_def),
            'uses_helper', (SELECT def ILIKE '%guest_shop_resolve_credit_unit_amount%' FROM create_order_def),
            'settles_cny', (SELECT def ILIKE '%v_currency := ''CNY''%' FROM create_order_def),
            'raises_credit_unavailable', (SELECT def ILIKE '%guest_credit_price_unavailable%' FROM create_order_def),
            'mentions_cash_price', (SELECT def ILIKE '%guest_cash_price%' FROM create_order_def),
            'accepts_client_amount', (
                SELECT def ~* 'p_(unit_)?amount\s+NUMERIC|p_price\s+NUMERIC|p_total_amount\s+NUMERIC'
                FROM create_order_def
            )
        ),
        jsonb_build_object(
            'present', true,
            'uses_helper', true,
            'settles_cny', true,
            'raises_credit_unavailable', true,
            'mentions_cash_price', false,
            'accepts_client_amount', false
        )

    UNION ALL

    SELECT
        4,
        'helper_credit_price_body',
        jsonb_build_object(
            'present', (SELECT def IS NOT NULL FROM helper_def),
            'uses_sku_points', (SELECT def ILIKE '%p_sku_price_points%' FROM helper_def),
            'qty_fixed_to_one', (SELECT def ILIKE '%p_quantity IS DISTINCT FROM 1%' FROM helper_def),
            'flash_least', (SELECT def ILIKE '%LEAST(%' FROM helper_def),
            'no_product_price_fallback', (
                SELECT def !~* 'p_product_price_points|guest_cash_price'
                FROM helper_def
            )
        ),
        jsonb_build_object(
            'present', true,
            'uses_sku_points', true,
            'qty_fixed_to_one', true,
            'flash_least', true,
            'no_product_price_fallback', true
        )

    UNION ALL

    SELECT
        5,
        'settlement_currency_constraints',
        (
            SELECT jsonb_build_object(
                'orders_currency_is_cny',
                COALESCE(defs->>'guest_shop_orders_currency_check', '')
                    ~* 'currency(\))?(::text)?\s*=\s*''CNY''',
                'payments_currency_is_cny',
                COALESCE(defs->>'guest_shop_payment_orders_currency_check', '')
                    ~* 'currency(\))?(::text)?\s*=\s*''CNY''',
                'orders_site_currency_both_cny',
                COALESCE(defs->>'guest_shop_orders_site_currency_check', '')
                    ~* 'site(\))?(::text)?\s*=\s*''cn'''
                AND COALESCE(defs->>'guest_shop_orders_site_currency_check', '')
                    ~* 'site(\))?(::text)?\s*=\s*''intl'''
                AND COALESCE(defs->>'guest_shop_orders_site_currency_check', '')
                    ~* 'currency(\))?(::text)?\s*=\s*''CNY'''
                AND COALESCE(defs->>'guest_shop_orders_site_currency_check', '')
                    !~* '''USD''',
                'payments_site_currency_both_cny',
                COALESCE(defs->>'guest_shop_payment_orders_site_currency_check', '')
                    ~* 'site(\))?(::text)?\s*=\s*''cn'''
                AND COALESCE(defs->>'guest_shop_payment_orders_site_currency_check', '')
                    ~* 'site(\))?(::text)?\s*=\s*''intl'''
                AND COALESCE(defs->>'guest_shop_payment_orders_site_currency_check', '')
                    ~* 'currency(\))?(::text)?\s*=\s*''CNY'''
                AND COALESCE(defs->>'guest_shop_payment_orders_site_currency_check', '')
                    !~* '''USD''',
                'events_observed_still_allows_usd',
                COALESCE(defs->>'guest_shop_payment_events_observed_currency_check', '')
                    ~* '''USD''',
                'defs', defs
            )
            FROM currency_defs
        ),
        jsonb_build_object(
            'orders_currency_is_cny', true,
            'payments_currency_is_cny', true,
            'orders_site_currency_both_cny', true,
            'payments_site_currency_both_cny', true,
            'events_observed_still_allows_usd', true
        )

    UNION ALL

    SELECT
        6,
        'leftover_cash_price_columns_kept',
        jsonb_build_object('present_count', (SELECT present_count FROM leftover_cash_columns)),
        jsonb_build_object('present_count', 4)

    UNION ALL

    SELECT
        7,
        'no_non_cny_settlement_rows',
        to_jsonb(leftover_non_cny),
        jsonb_build_object('orders', 0, 'payments', 0)
    FROM leftover_non_cny

    UNION ALL

    SELECT
        8,
        'guest_products_remain_disabled_or_review',
        jsonb_build_object('enabled_count', (SELECT enabled_count FROM enabled_products)),
        to_jsonb('this check is informational; do not enable products from SQL'::TEXT)
)
SELECT
    sort_order,
    check_name,
    observed,
    expected,
    CASE
        WHEN check_name = 'credit_pricing_functions' THEN
            CASE
                WHEN jsonb_array_length(observed) = 2
                 AND NOT EXISTS (
                     SELECT 1
                     FROM jsonb_array_elements(observed) item
                     WHERE (item->>'present')::BOOLEAN IS NOT TRUE
                        OR (item->>'search_path_pinned')::BOOLEAN IS NOT TRUE
                        OR ((item->>'function_name') = 'guest_shop_resolve_credit_unit_amount'
                            AND (
                                (item->>'security_definer')::BOOLEAN IS TRUE
                                OR (item->>'provolatile') <> 's'
                            ))
                        OR ((item->>'function_name') = 'fn_guest_shop_create_order'
                            AND (item->>'security_definer')::BOOLEAN IS NOT TRUE)
                 )
                THEN 'PASS' ELSE 'FAIL'
            END
        WHEN check_name = 'credit_pricing_grants' THEN
            CASE
                WHEN jsonb_array_length(observed) = 2
                 AND NOT EXISTS (
                     SELECT 1
                     FROM jsonb_array_elements(observed) item
                     WHERE (item->>'service_role_execute')::BOOLEAN IS NOT TRUE
                        OR (item->>'anon_execute')::BOOLEAN IS TRUE
                        OR (item->>'authenticated_execute')::BOOLEAN IS TRUE
                        OR (item->>'public_execute')::BOOLEAN IS TRUE
                 )
                THEN 'PASS' ELSE 'FAIL'
            END
        WHEN check_name = 'create_order_credit_price_body' THEN
            CASE
                WHEN (observed->>'present')::BOOLEAN
                 AND (observed->>'uses_helper')::BOOLEAN
                 AND (observed->>'settles_cny')::BOOLEAN
                 AND (observed->>'raises_credit_unavailable')::BOOLEAN
                 AND (observed->>'mentions_cash_price')::BOOLEAN IS NOT TRUE
                 AND (observed->>'accepts_client_amount')::BOOLEAN IS NOT TRUE
                THEN 'PASS' ELSE 'FAIL'
            END
        WHEN check_name = 'helper_credit_price_body' THEN
            CASE
                WHEN (observed->>'present')::BOOLEAN
                 AND (observed->>'uses_sku_points')::BOOLEAN
                 AND (observed->>'qty_fixed_to_one')::BOOLEAN
                 AND (observed->>'flash_least')::BOOLEAN
                 AND (observed->>'no_product_price_fallback')::BOOLEAN
                THEN 'PASS' ELSE 'FAIL'
            END
        WHEN check_name = 'settlement_currency_constraints' THEN
            CASE
                -- pg_get_constraintdef() emits (currency)::text = 'CNY'::text,
                -- not the source CHECK (currency = 'CNY'). Compare boolean
                -- flags derived from that canonical dump.
                WHEN (observed->>'orders_currency_is_cny')::BOOLEAN
                 AND (observed->>'payments_currency_is_cny')::BOOLEAN
                 AND (observed->>'orders_site_currency_both_cny')::BOOLEAN
                 AND (observed->>'payments_site_currency_both_cny')::BOOLEAN
                 AND (observed->>'events_observed_still_allows_usd')::BOOLEAN
                THEN 'PASS' ELSE 'FAIL'
            END
        WHEN check_name = 'leftover_cash_price_columns_kept' THEN
            CASE
                WHEN (observed->>'present_count')::INT = 4 THEN 'PASS' ELSE 'FAIL'
            END
        WHEN check_name = 'no_non_cny_settlement_rows' THEN
            CASE
                WHEN (observed->>'orders')::BIGINT = 0
                 AND (observed->>'payments')::BIGINT = 0
                THEN 'PASS' ELSE 'FAIL'
            END
        WHEN check_name = 'guest_products_remain_disabled_or_review' THEN
            CASE
                WHEN (observed->>'enabled_count')::BIGINT = 0 THEN 'PASS' ELSE 'REVIEW'
            END
        ELSE 'REVIEW'
    END AS status
FROM checks
ORDER BY sort_order;
