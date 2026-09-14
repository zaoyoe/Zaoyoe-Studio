-- Read-only postflight for 20260913_guest_shop_atomic_rpcs.sql.
--
-- Run this after the atomic-RPC migration.  It returns one result set so the
-- complete gate can be copied from Supabase SQL Editor.  This script never
-- writes to a table, function, privilege, or policy.

WITH expected_functions(name, identity_args, requires_definer, expected_search_path) AS (
    VALUES
        ('guest_shop_require_service_role', '', true, 'search_path=public, pg_temp'),
        -- These helpers are immutable, table-free SQL functions.  They are
        -- intentionally SECURITY INVOKER; requiring SECURITY DEFINER here
        -- would add privilege without protecting any table access.
        ('guest_shop_normalize_site', 'text', false, 'search_path=public, pg_temp'),
        ('guest_shop_payment_is_final_success', 'text', false, 'search_path=public, pg_temp'),
        ('guest_shop_validate_inventory_reservation', '', true, 'search_path=public, pg_temp'),
        -- These two trigger functions are inherited from the foundation
        -- migration.  They intentionally remain SECURITY INVOKER and pin
        -- search_path to public; table/RPC writes are service-role-only.
        ('guest_shop_validate_payment_order', '', false, 'search_path=public'),
        ('guest_shop_validate_payment_event', '', false, 'search_path=public'),
        ('fn_guest_shop_confirm_payment', 'uuid, uuid, text, text, text, text, numeric, text, text, boolean, boolean, boolean, boolean', true, 'search_path=public, pg_temp'),
        ('fn_guest_shop_consume_reservation', 'uuid, uuid', true, 'search_path=public, pg_temp'),
        ('fn_guest_shop_claim_fulfillment', 'uuid, uuid', true, 'search_path=public, pg_temp'),
        ('fn_guest_shop_mark_fulfilled', 'uuid, uuid', true, 'search_path=public, pg_temp'),
        ('fn_guest_shop_record_refund_result', 'uuid, text, text, text, text', true, 'search_path=public, pg_temp'),
        ('fn_guest_shop_release_reservation', 'uuid, uuid, text', true, 'search_path=public, pg_temp'),
        ('fn_guest_shop_release_expired_reservations', 'integer', true, 'search_path=public, pg_temp'),
        ('fn_guest_shop_create_order', 'text, uuid, uuid, text, text, text, text, text, text, text, text, integer', true, 'search_path=public, pg_temp')
), checks AS (
    SELECT
        1 AS sort_order,
        'atomic_columns'::TEXT AS check_name,
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
                      (c.table_name = 'guest_shop_payment_events' AND c.column_name IN ('observed_site', 'observed_currency', 'observed_amount', 'observed_purpose'))
                      OR (c.table_name = 'guest_shop_payment_orders' AND c.column_name = 'refund_provider_ref')
                      OR (c.table_name = 'guest_shop_orders' AND c.column_name IN ('snapshot_delivery_type', 'snapshot_manual_delivery', 'snapshot_sku_manual_delivery'))
                      OR (c.table_name = 'guest_shop_inventory_reservations' AND c.column_name = 'inventory_source_sku_id')
                  )
            ),
            '[]'::JSONB
        ) AS observed,
        to_jsonb('all atomic snapshot/observation columns present'::TEXT) AS expected

    UNION ALL

    SELECT
        2,
        'source_snapshot_constraints',
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'constraint_name', c.conname,
                        'definition', pg_get_constraintdef(c.oid)
                    )
                    ORDER BY c.conname
                )
                FROM pg_constraint c
                WHERE c.conrelid = 'public.guest_shop_inventory_reservations'::REGCLASS
                  AND c.conname IN (
                      'guest_shop_inventory_reservations_source_sku_fk',
                      'guest_shop_inventory_reservations_source_sku_product_fk'
                  )
            ),
            '[]'::JSONB
        ),
        to_jsonb('both source SKU FKs present with ON DELETE RESTRICT'::TEXT)

    UNION ALL

    SELECT
        3,
        'atomic_constraints',
        COALESCE(
            (
                SELECT jsonb_agg(to_jsonb(c.conname) ORDER BY c.conrelid::REGCLASS::TEXT, c.conname)
                FROM pg_constraint c
                WHERE c.conrelid IN (
                    'public.guest_shop_orders'::REGCLASS,
                    'public.guest_shop_payment_orders'::REGCLASS,
                    'public.guest_shop_payment_events'::REGCLASS,
                    'public.shop_products'::REGCLASS,
                    'public.shop_product_skus'::REGCLASS
                )
                  AND c.conname IN (
                      'guest_shop_orders_amount_check',
                      'guest_shop_orders_idempotency_key_format_check',
                      'guest_shop_orders_request_fingerprint_check',
                      'guest_shop_orders_claim_secret_hash_format_check',
                      'guest_shop_payment_orders_expected_amount_check',
                      'guest_shop_payment_orders_paid_amount_check',
                      'guest_shop_payment_orders_fee_check',
                      'guest_shop_payment_orders_merchant_order_no_check',
                      'guest_shop_payment_orders_provider_check',
                      'guest_shop_payment_orders_channel_check',
                      'guest_shop_payment_orders_provider_order_no_check',
                      'guest_shop_payment_events_observed_site_check',
                      'guest_shop_payment_events_observed_currency_check',
                      'guest_shop_payment_events_observed_amount_check',
                      'guest_shop_payment_events_observed_purpose_check',
                      'guest_shop_payment_events_provider_check',
                      'guest_shop_payment_events_event_key_format_check',
                      'guest_shop_payment_events_provider_order_no_check',
                      'guest_shop_payment_events_provider_event_id_check',
                      'shop_products_guest_cash_price_cny_check',
                      'shop_products_guest_cash_price_intl_check',
                      'shop_product_skus_guest_cash_price_cny_check',
                      'shop_product_skus_guest_cash_price_intl_check'
                  )
            ),
            '[]'::JSONB
        ),
        to_jsonb('atomic money/identifier constraints present'::TEXT)

    UNION ALL

    SELECT
        4,
        'atomic_functions',
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'name', e.name,
                        'identity_args', e.identity_args,
                        'present', p.oid IS NOT NULL,
                        'requires_definer', e.requires_definer,
                        'security_definer', COALESCE(p.prosecdef, false),
                        'expected_search_path', e.expected_search_path,
                        'search_path_pinned', COALESCE(p.proconfig @> ARRAY[e.expected_search_path]::TEXT[], false)
                    )
                    ORDER BY e.name
                )
                FROM expected_functions e
                LEFT JOIN pg_proc p
                  ON p.oid = to_regprocedure(
                      format('public.%I(%s)', e.name, e.identity_args)
                  )::OID
            ),
            '[]'::JSONB
        ),
        to_jsonb('all expected functions exist with the required security attributes and pinned search_path'::TEXT)

    UNION ALL

    SELECT
        5,
        'create_order_overloads',
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'identity_args', pg_get_function_identity_arguments(p.oid),
                        'oid', p.oid::TEXT
                    )
                    ORDER BY pg_get_function_identity_arguments(p.oid)
                )
                FROM pg_proc p
                WHERE p.pronamespace = 'public'::REGNAMESPACE
                  AND p.proname = 'fn_guest_shop_create_order'
            ),
            '[]'::JSONB
        ),
        to_jsonb('exactly one overload, with no client amount argument'::TEXT)

    UNION ALL

    SELECT
        6,
        'reservation_trigger',
        COALESCE(
            (
                SELECT jsonb_agg(to_jsonb(pg_get_triggerdef(t.oid)) ORDER BY t.tgname)
                FROM pg_trigger t
                WHERE t.tgrelid = 'public.guest_shop_inventory_reservations'::REGCLASS
                  AND t.tgname = 'trg_guest_shop_validate_inventory_reservation'
                  AND NOT t.tgisinternal
            ),
            '[]'::JSONB
        ),
        to_jsonb('site-aware reservation validation trigger present'::TEXT)

    UNION ALL

    SELECT
        7,
        'service_role_grants',
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'name', e.name,
                        'identity_args', e.identity_args,
                        'service_role_execute', has_function_privilege('service_role', p.oid, 'EXECUTE'),
                        'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
                        'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    )
                    ORDER BY e.name
                )
                FROM expected_functions e
                JOIN pg_proc p
                  ON p.oid = to_regprocedure(
                      format('public.%I(%s)', e.name, e.identity_args)
                  )::OID
            ),
            '[]'::JSONB
        ),
        to_jsonb('service_role only; anon/authenticated execute must be false'::TEXT)

    UNION ALL

    SELECT
        8,
        'rls_state',
        COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'table_name', c.relname,
                        'rowsecurity', c.relrowsecurity,
                        'force_row_security', c.relforcerowsecurity
                    )
                    ORDER BY c.relname
                )
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                  AND c.relname IN (
                      'guest_shop_orders',
                      'guest_shop_inventory_reservations',
                      'guest_shop_payment_orders',
                      'guest_shop_payment_events'
                  )
            ),
            '[]'::JSONB
        ),
        to_jsonb('all guest tables have RLS enabled'::TEXT)

    UNION ALL

    SELECT
        9,
        'guest_data_invariants',
        jsonb_build_object(
            'orders', (SELECT COUNT(*) FROM public.guest_shop_orders),
            'reservations', (SELECT COUNT(*) FROM public.guest_shop_inventory_reservations),
            'payment_orders', (SELECT COUNT(*) FROM public.guest_shop_payment_orders),
            'payment_events', (SELECT COUNT(*) FROM public.guest_shop_payment_events),
            'non_pending_orders', (SELECT COUNT(*) FROM public.guest_shop_orders WHERE payment_status <> 'pending'),
            'null_source_snapshots', (SELECT COUNT(*) FROM public.guest_shop_inventory_reservations WHERE inventory_source_sku_id IS NULL),
            'invalid_source_snapshots', (
                SELECT COUNT(*)
                FROM public.guest_shop_inventory_reservations r
                LEFT JOIN public.shop_product_skus s ON s.id = r.inventory_source_sku_id
                WHERE s.id IS NULL OR s.product_id IS DISTINCT FROM r.product_id
            )
        ),
        to_jsonb('zero rows before first rollout; otherwise all source snapshot counts must be 0'::TEXT)

    UNION ALL

    SELECT
        10,
        'payment_data_invariants',
        jsonb_build_object(
            'invalid_site_currency', (
                SELECT COUNT(*)
                FROM public.guest_shop_payment_orders
                WHERE NOT ((site = 'cn' AND currency = 'CNY') OR (site = 'intl' AND currency = 'USD'))
            ),
            'invalid_amount_binding', (
                SELECT COUNT(*)
                FROM public.guest_shop_payment_orders p
                JOIN public.guest_shop_orders o ON o.id = p.guest_order_id
                WHERE p.expected_amount <> o.total_amount
            ),
            'orphan_events', (
                SELECT COUNT(*)
                FROM public.guest_shop_payment_events e
                LEFT JOIN public.guest_shop_payment_orders p ON p.id = e.payment_order_id
                WHERE p.id IS NULL AND NULLIF(BTRIM(e.merchant_order_no), '') IS NULL
            )
        ),
        to_jsonb('all three counts must be 0'::TEXT)
)
SELECT
    sort_order,
    check_name,
    observed,
    expected,
    CASE
        WHEN check_name = 'atomic_columns' THEN
            CASE WHEN jsonb_array_length(observed) = 9 THEN 'PASS' ELSE 'FAIL' END
        WHEN check_name = 'source_snapshot_constraints' THEN
            CASE
                WHEN jsonb_array_length(observed) = 2
                 AND NOT EXISTS (
                     SELECT 1
                     FROM jsonb_array_elements(observed) item
                     WHERE (item->>'definition') NOT ILIKE '%FOREIGN KEY%'
                        OR (item->>'definition') NOT ILIKE '%ON DELETE RESTRICT%'
                 )
                THEN 'PASS' ELSE 'FAIL'
            END
        WHEN check_name = 'atomic_constraints' THEN
            CASE WHEN jsonb_array_length(observed) >= 23 THEN 'PASS' ELSE 'FAIL' END
        WHEN check_name = 'atomic_functions' THEN
            CASE
                WHEN jsonb_array_length(observed) = 14
                 AND NOT EXISTS (
                     SELECT 1
                     FROM jsonb_array_elements(observed) item
                     WHERE (item->>'present')::BOOLEAN IS NOT TRUE
                        OR (item->>'search_path_pinned')::BOOLEAN IS NOT TRUE
                        OR ((item->>'requires_definer')::BOOLEAN IS TRUE
                            AND (item->>'security_definer')::BOOLEAN IS NOT TRUE)
                        OR ((item->>'requires_definer')::BOOLEAN IS FALSE
                            AND (item->>'security_definer')::BOOLEAN IS TRUE)
                 )
                THEN 'PASS' ELSE 'FAIL'
            END
        WHEN check_name = 'create_order_overloads' THEN
            CASE
                WHEN jsonb_array_length(observed) = 1
                 AND NOT EXISTS (
                     SELECT 1
                     FROM jsonb_array_elements(observed) item
                     WHERE (item->>'identity_args') ILIKE '%numeric%'
                 )
                THEN 'PASS' ELSE 'FAIL'
            END
        WHEN check_name = 'reservation_trigger' THEN
            CASE WHEN jsonb_array_length(observed) = 1 THEN 'PASS' ELSE 'FAIL' END
        WHEN check_name = 'service_role_grants' THEN
            CASE
                WHEN jsonb_array_length(observed) = 14
                 AND NOT EXISTS (
                     SELECT 1
                     FROM jsonb_array_elements(observed) item
                     WHERE (item->>'service_role_execute')::BOOLEAN IS NOT TRUE
                        OR (item->>'anon_execute')::BOOLEAN IS TRUE
                        OR (item->>'authenticated_execute')::BOOLEAN IS TRUE
                 )
                THEN 'PASS' ELSE 'FAIL'
            END
        WHEN check_name = 'rls_state' THEN
            CASE
                WHEN jsonb_array_length(observed) = 4
                 AND NOT EXISTS (
                     SELECT 1 FROM jsonb_array_elements(observed) item
                     WHERE (item->>'rowsecurity')::BOOLEAN IS NOT TRUE
                 )
                THEN 'PASS' ELSE 'FAIL'
            END
        WHEN check_name = 'guest_data_invariants' THEN
            CASE
                WHEN (observed->>'null_source_snapshots')::BIGINT = 0
                 AND (observed->>'invalid_source_snapshots')::BIGINT = 0
                THEN 'PASS' ELSE 'FAIL'
            END
        WHEN check_name = 'payment_data_invariants' THEN
            CASE
                WHEN (observed->>'invalid_site_currency')::BIGINT = 0
                 AND (observed->>'invalid_amount_binding')::BIGINT = 0
                 AND (observed->>'orphan_events')::BIGINT = 0
                THEN 'PASS' ELSE 'FAIL'
            END
        ELSE 'REVIEW'
    END AS status
FROM checks
ORDER BY sort_order;
