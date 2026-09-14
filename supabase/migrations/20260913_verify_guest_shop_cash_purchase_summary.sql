-- Read-only one-result verification for the guest cash purchase foundation.
-- Run after 20260913_add_guest_shop_cash_purchase.sql.
-- This intentionally returns one result set so the full result can be copied
-- from SQL editors that only show the last result of a multi-SELECT batch.

WITH checks AS (
    SELECT
        1 AS sort_order,
        'tables'::TEXT AS check_name,
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
        'guest_columns',
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'table_name', c.table_name,
                        'column_name', c.column_name,
                        'data_type', c.data_type,
                        'is_nullable', c.is_nullable
                    )
                    ORDER BY c.table_name, c.ordinal_position
                )
                FROM information_schema.columns c
                WHERE c.table_schema = 'public'
                  AND (
                      c.table_name IN (
                          'guest_shop_orders',
                          'guest_shop_inventory_reservations',
                          'guest_shop_payment_orders',
                          'guest_shop_payment_events'
                      )
                      OR (
                          c.table_name IN ('shop_products', 'shop_product_skus')
                          AND (
                              c.column_name LIKE 'guest_%'
                              OR c.column_name = 'allow_guest_purchase'
                          )
                      )
                  )
            ),
            '[]'::JSONB
        ),
        to_jsonb('guest tables plus guest_* / allow_guest_purchase columns'::TEXT)

    UNION ALL

    SELECT
        3,
        'guest_constraints',
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'table_name', c.conrelid::REGCLASS::TEXT,
                        'constraint_name', c.conname,
                        'definition', pg_get_constraintdef(c.oid)
                    )
                    ORDER BY c.conrelid::REGCLASS::TEXT, c.conname
                )
                FROM pg_constraint c
                WHERE c.conrelid IN (
                    'public.guest_shop_orders'::REGCLASS,
                    'public.guest_shop_inventory_reservations'::REGCLASS,
                    'public.guest_shop_payment_orders'::REGCLASS,
                    'public.guest_shop_payment_events'::REGCLASS,
                    'public.shop_products'::REGCLASS,
                    'public.shop_product_skus'::REGCLASS
                )
                  AND c.conname LIKE '%guest%'
            ),
            '[]'::JSONB
        ),
        to_jsonb('guest constraints present'::TEXT)

    UNION ALL

    SELECT
        4,
        'validation_functions',
        COALESCE(
            (
                SELECT jsonb_agg(to_jsonb(p.proname) ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))
                FROM pg_proc p
                JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public'
                  AND p.proname IN (
                      'guest_shop_validate_inventory_reservation',
                      'guest_shop_validate_payment_order',
                      'guest_shop_validate_payment_event'
                  )
            ),
            '[]'::JSONB
        ),
        '["guest_shop_validate_inventory_reservation","guest_shop_validate_payment_event","guest_shop_validate_payment_order"]'::JSONB

    UNION ALL

    SELECT
        5,
        'guest_triggers',
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'table_name', c.relname,
                        'trigger_name', t.tgname,
                        'definition', pg_get_triggerdef(t.oid)
                    )
                    ORDER BY c.relname, t.tgname
                )
                FROM pg_trigger t
                JOIN pg_class c ON c.oid = t.tgrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                  AND t.tgname LIKE 'trg_guest_shop_%'
                  AND NOT t.tgisinternal
            ),
            '[]'::JSONB
        ),
        to_jsonb('guest validation triggers present'::TEXT)

    UNION ALL

    SELECT
        6,
        'rls_policies',
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'table_name', p.tablename,
                        'policy_name', p.policyname,
                        'roles', p.roles,
                        'command', p.cmd
                    )
                    ORDER BY p.tablename, p.policyname
                )
                FROM pg_policies p
                WHERE p.schemaname = 'public'
                  AND p.tablename IN (
                      'guest_shop_orders',
                      'guest_shop_inventory_reservations',
                      'guest_shop_payment_orders',
                      'guest_shop_payment_events'
                  )
            ),
            '[]'::JSONB
        ),
        to_jsonb('admin SELECT policies only; no anonymous write policy'::TEXT)

    UNION ALL

    SELECT
        7,
        'guest_indexes',
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'index_name', i.indexname,
                        'table_name', i.tablename,
                        'definition', i.indexdef
                    )
                    ORDER BY i.tablename, i.indexname
                )
                FROM pg_indexes i
                WHERE i.schemaname = 'public'
                  AND i.indexname LIKE '%guest%'
            ),
            '[]'::JSONB
        ),
        to_jsonb('guest indexes present'::TEXT)

    UNION ALL

    SELECT
        8,
        'guest_order_counts',
        (
            SELECT jsonb_build_object(
                'guest_orders', COUNT(*),
                'non_pending_orders', COUNT(*) FILTER (WHERE payment_status <> 'pending')
            )
            FROM public.guest_shop_orders
        ),
        '{"guest_orders":"any non-negative integer","non_pending_orders":"any non-negative integer"}'::JSONB

    UNION ALL

    SELECT
        9,
        'enabled_guest_products',
        to_jsonb((SELECT COUNT(*) FROM public.shop_products WHERE allow_guest_purchase = true)),
        to_jsonb('non-negative integer'::TEXT)

    UNION ALL

    SELECT
        10,
        'invalid_guest_order_site_currency',
        to_jsonb((
            SELECT COUNT(*)
            FROM public.guest_shop_orders
            WHERE NOT ((site = 'cn' AND currency = 'CNY') OR (site = 'intl' AND currency = 'USD'))
        )),
        '0'::JSONB

    UNION ALL

    SELECT
        11,
        'invalid_guest_payment_snapshots',
        to_jsonb((
            SELECT COUNT(*)
            FROM public.guest_shop_payment_orders p
            JOIN public.guest_shop_orders o ON o.id = p.guest_order_id
            WHERE p.merchant_order_no <> o.order_no
               OR p.site <> o.site
               OR p.currency <> o.currency
               OR p.expected_amount <> o.total_amount
        )),
        '0'::JSONB

    UNION ALL

    SELECT
        12,
        'invalid_guest_reservations',
        to_jsonb((
            SELECT COUNT(*)
            FROM public.guest_shop_inventory_reservations r
            JOIN public.guest_shop_orders o ON o.id = r.order_id
            JOIN public.shop_inventory i ON i.id = r.inventory_id
            WHERE r.product_id <> o.product_id
               OR r.sku_id <> o.sku_id
               OR r.site <> o.site
               OR i.product_id IS DISTINCT FROM o.product_id
               OR (i.sku_id IS NOT NULL AND i.sku_id <> o.sku_id)
               OR COALESCE(i.is_shared, false)
        )),
        '0'::JSONB

    UNION ALL

    SELECT
        13,
        'orphan_payment_events',
        to_jsonb((
            SELECT COUNT(*)
            FROM public.guest_shop_payment_events e
            LEFT JOIN public.guest_shop_payment_orders p ON p.id = e.payment_order_id
            WHERE p.id IS NULL AND NULLIF(BTRIM(e.merchant_order_no), '') IS NULL
        )),
        '0'::JSONB
)
SELECT
    sort_order,
    check_name,
    observed,
    expected,
    CASE
        WHEN check_name IN (
            'invalid_guest_order_site_currency',
            'invalid_guest_payment_snapshots',
            'invalid_guest_reservations',
            'orphan_payment_events'
        ) THEN CASE WHEN observed = '0'::JSONB THEN 'PASS' ELSE 'FAIL' END
        WHEN check_name = 'tables' THEN CASE
            WHEN observed = expected THEN 'PASS'
            ELSE 'CHECK'
        END
        WHEN check_name = 'validation_functions' THEN CASE
            WHEN observed @> expected AND jsonb_array_length(observed) >= jsonb_array_length(expected) THEN 'PASS'
            ELSE 'CHECK'
        END
        ELSE 'REVIEW'
    END AS status
FROM checks
ORDER BY sort_order;
