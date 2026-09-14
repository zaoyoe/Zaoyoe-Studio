-- Read-only preflight for 20260913_guest_shop_atomic_rpcs.sql.
--
-- Run this before the atomic-RPC migration when possible.  It does not create
-- objects or modify data.  A BLOCK result means the migration must not be
-- started until the reported condition is reconciled.  REVIEW means the
-- migration may be technically applicable, but an operator should inspect
-- the observed value (for example, an existing legacy function overload).

WITH checks AS (
    SELECT
        1 AS sort_order,
        'foundation_tables'::TEXT AS check_name,
        COALESCE(
            (
                SELECT jsonb_agg(to_jsonb(t.table_name) ORDER BY t.table_name)
                FROM information_schema.tables t
                WHERE t.table_schema = 'public'
                  AND t.table_name IN (
                      'guest_shop_orders',
                      'guest_shop_inventory_reservations',
                      'guest_shop_payment_orders',
                      'guest_shop_payment_events'
                  )
            ),
            '[]'::JSONB
        ) AS observed,
        '["guest_shop_inventory_reservations","guest_shop_orders","guest_shop_payment_events","guest_shop_payment_orders"]'::JSONB AS expected

    UNION ALL

    SELECT
        2,
        'site_scoped_source_resolver',
        jsonb_build_object(
            'exact_signature_exists', to_regprocedure(
                'public.fn_resolve_shop_sku_inventory_sources(uuid,text)'
            ) IS NOT NULL,
            'identity_args', (
                SELECT pg_get_function_identity_arguments(p.oid)
                FROM pg_proc p
                WHERE p.oid = to_regprocedure(
                    'public.fn_resolve_shop_sku_inventory_sources(uuid,text)'
                )::OID
            ),
            'security_definer', COALESCE((
                SELECT p.prosecdef
                FROM pg_proc p
                WHERE p.oid = to_regprocedure(
                    'public.fn_resolve_shop_sku_inventory_sources(uuid,text)'
                )::OID
            ), false),
            'search_path_pinned', COALESCE((
                SELECT p.proconfig @> ARRAY['search_path=public, pg_temp']::TEXT[]
                FROM pg_proc p
                WHERE p.oid = to_regprocedure(
                    'public.fn_resolve_shop_sku_inventory_sources(uuid,text)'
                )::OID
            ), false),
            'all_matching_signatures', COALESCE((
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'oid', p.oid::TEXT,
                        'identity_args', pg_get_function_identity_arguments(p.oid),
                        'security_definer', p.prosecdef,
                        'search_path_pinned', p.proconfig @> ARRAY['search_path=public, pg_temp']::TEXT[]
                    )
                    ORDER BY pg_get_function_identity_arguments(p.oid)
                )
                FROM pg_proc p
                JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public'
                  AND p.proname = 'fn_resolve_shop_sku_inventory_sources'
            ), '[]'::JSONB)
        ),
        '{"exact_signature_exists":true,"security_definer":true,"search_path_pinned":true}'::JSONB

    UNION ALL

    SELECT
        3,
        'required_shop_columns',
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'table_name', c.table_name,
                        'column_name', c.column_name,
                        'data_type', c.data_type,
                        'is_nullable', c.is_nullable
                    )
                    ORDER BY c.table_name, c.column_name
                )
                FROM information_schema.columns c
                WHERE c.table_schema = 'public'
                  AND (
                      (c.table_name = 'shop_products' AND c.column_name IN ('delivery_type', 'manual_delivery'))
                      OR (c.table_name = 'shop_product_skus' AND c.column_name IN (
                          'inventory_sku_id',
                          'inventory_source_sku_ids',
                          'inventory_source_sku_ids_intl',
                          'manual_delivery'
                      ))
                  )
            ),
            '[]'::JSONB
        ),
        to_jsonb('shop_products.delivery_type/manual_delivery and SKU source/manual-delivery columns'::TEXT)

    UNION ALL

    SELECT
        4,
        'guest_rows',
        jsonb_build_object(
            'orders', (SELECT COUNT(*) FROM public.guest_shop_orders),
            'reservations', (SELECT COUNT(*) FROM public.guest_shop_inventory_reservations),
            'payment_orders', (SELECT COUNT(*) FROM public.guest_shop_payment_orders),
            'payment_events', (SELECT COUNT(*) FROM public.guest_shop_payment_events)
        ),
        to_jsonb('all four counts must be 0 for first production application'::TEXT)

    UNION ALL

    SELECT
        5,
        'invalid_existing_guest_prices',
        to_jsonb((
            SELECT COUNT(*)
            FROM (
                SELECT id
                FROM public.shop_products
                WHERE guest_cash_price_cny IS NOT NULL
                  AND (
                      LOWER(guest_cash_price_cny::TEXT) IN ('nan', 'infinity', '-infinity')
                      OR guest_cash_price_cny <= 0
                      OR guest_cash_price_cny > 999999999999.99
                      OR guest_cash_price_cny <> ROUND(guest_cash_price_cny, 2)
                  )
                UNION ALL
                SELECT id
                FROM public.shop_products
                WHERE guest_cash_price_intl IS NOT NULL
                  AND (
                      LOWER(guest_cash_price_intl::TEXT) IN ('nan', 'infinity', '-infinity')
                      OR guest_cash_price_intl <= 0
                      OR guest_cash_price_intl > 999999999999.99
                      OR guest_cash_price_intl <> ROUND(guest_cash_price_intl, 2)
                  )
                UNION ALL
                SELECT id
                FROM public.shop_product_skus
                WHERE guest_cash_price_cny IS NOT NULL
                  AND (
                      LOWER(guest_cash_price_cny::TEXT) IN ('nan', 'infinity', '-infinity')
                      OR guest_cash_price_cny <= 0
                      OR guest_cash_price_cny > 999999999999.99
                      OR guest_cash_price_cny <> ROUND(guest_cash_price_cny, 2)
                  )
                UNION ALL
                SELECT id
                FROM public.shop_product_skus
                WHERE guest_cash_price_intl IS NOT NULL
                  AND (
                      LOWER(guest_cash_price_intl::TEXT) IN ('nan', 'infinity', '-infinity')
                      OR guest_cash_price_intl <= 0
                      OR guest_cash_price_intl > 999999999999.99
                      OR guest_cash_price_intl <> ROUND(guest_cash_price_intl, 2)
                  )
            ) invalid_rows
        )),
        '0'::JSONB

    UNION ALL

    SELECT
        6,
        'enabled_guest_products',
        to_jsonb((SELECT COUNT(*) FROM public.shop_products WHERE allow_guest_purchase = true)),
        to_jsonb('0 is safest before rollout; a positive count requires a product/SKU source audit'::TEXT)

    UNION ALL

    SELECT
        7,
        'legacy_create_order_overload',
        jsonb_build_object(
            'legacy_signature_exists', to_regprocedure(
                'public.fn_guest_shop_create_order(text,uuid,uuid,text,text,text,numeric,text,text,text,text,text,integer)'
            ) IS NOT NULL,
            'legacy_dependency_count', COALESCE((
                SELECT COUNT(*)
                FROM pg_depend d
                WHERE d.refobjid = to_regprocedure(
                    'public.fn_guest_shop_create_order(text,uuid,uuid,text,text,text,numeric,text,text,text,text,text,integer)'
                )
                  AND d.deptype <> 'i'
            ), 0)
        ),
        to_jsonb('legacy overload may exist (migration drops it); dependency count must be 0'::TEXT)

    UNION ALL

    SELECT
        8,
        'required_extensions',
        jsonb_build_object(
            'gen_random_uuid', to_regprocedure('gen_random_uuid()') IS NOT NULL,
            'hashtextextended', to_regprocedure('hashtextextended(text,bigint)') IS NOT NULL
        ),
        '{"gen_random_uuid":true,"hashtextextended":true}'::JSONB
)
SELECT
    sort_order,
    check_name,
    observed,
    expected,
    CASE
        WHEN check_name = 'foundation_tables' THEN
            CASE WHEN observed = expected THEN 'PASS' ELSE 'BLOCK' END
        WHEN check_name = 'site_scoped_source_resolver' THEN
            CASE
                WHEN (observed->>'exact_signature_exists')::BOOLEAN IS TRUE
                 AND (observed->>'security_definer')::BOOLEAN IS TRUE
                 AND (observed->>'search_path_pinned')::BOOLEAN IS TRUE
                THEN 'PASS' ELSE 'BLOCK'
            END
        WHEN check_name = 'required_shop_columns' THEN
            CASE
                WHEN observed @> '[{"table_name":"shop_products","column_name":"delivery_type"},{"table_name":"shop_products","column_name":"manual_delivery"},{"table_name":"shop_product_skus","column_name":"inventory_sku_id"},{"table_name":"shop_product_skus","column_name":"inventory_source_sku_ids"},{"table_name":"shop_product_skus","column_name":"inventory_source_sku_ids_intl"},{"table_name":"shop_product_skus","column_name":"manual_delivery"}]'::JSONB
                THEN 'PASS' ELSE 'BLOCK'
            END
        WHEN check_name = 'guest_rows' THEN
            CASE
                WHEN (observed->>'orders')::BIGINT = 0
                 AND (observed->>'reservations')::BIGINT = 0
                 AND (observed->>'payment_orders')::BIGINT = 0
                 AND (observed->>'payment_events')::BIGINT = 0
                THEN 'PASS' ELSE 'BLOCK'
            END
        WHEN check_name = 'invalid_existing_guest_prices' THEN
            CASE WHEN observed = '0'::JSONB THEN 'PASS' ELSE 'BLOCK' END
        WHEN check_name = 'enabled_guest_products' THEN
            CASE WHEN observed = '0'::JSONB THEN 'PASS' ELSE 'REVIEW' END
        WHEN check_name = 'legacy_create_order_overload' THEN
            CASE
                WHEN COALESCE((observed->>'legacy_dependency_count')::BIGINT, 0) = 0 THEN 'PASS'
                ELSE 'BLOCK'
            END
        WHEN check_name = 'required_extensions' THEN
            CASE WHEN observed = expected THEN 'PASS' ELSE 'BLOCK' END
        ELSE 'REVIEW'
    END AS status
FROM checks
ORDER BY sort_order;
