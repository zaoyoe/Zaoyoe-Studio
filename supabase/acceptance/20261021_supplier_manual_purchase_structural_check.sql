-- ============================================================================
-- P2E manual-purchase structural check (read only, no side effects).
--
-- Proves only that the objects exist with the expected shape and grants.
-- It does NOT prove a purchase works: no money moves, no supplier is called and
-- no order is created. Business acceptance stays NOT RUN until a real,
-- operator-confirmed purchase is archived.
-- ============================================================================
SELECT 'table_manual_purchases' AS check_id,
       (to_regclass('public.shop_supplier_manual_purchases') IS NOT NULL) AS passed,
       'shop_supplier_manual_purchases' AS evidence
UNION ALL SELECT 'table_manual_purchase_events',
       (to_regclass('public.shop_supplier_manual_purchase_events') IS NOT NULL),
       'shop_supplier_manual_purchase_events'
UNION ALL SELECT 'fn_context',
       (to_regprocedure('public.fn_shop_supplier_manual_context_v2(uuid)') IS NOT NULL),
       'fn_shop_supplier_manual_context_v2'
UNION ALL SELECT 'fn_quote',
       (to_regprocedure('public.fn_shop_supplier_manual_quote_v2(uuid,uuid,text)') IS NOT NULL),
       'fn_shop_supplier_manual_quote_v2'
UNION ALL SELECT 'fn_confirm',
       (to_regprocedure('public.fn_shop_supplier_manual_confirm_v2(uuid,uuid,text)') IS NOT NULL),
       'fn_shop_supplier_manual_confirm_v2'
UNION ALL SELECT 'fn_record',
       (to_regprocedure('public.fn_shop_supplier_manual_record_v2(uuid,uuid,text,text,text,text,jsonb,text)') IS NOT NULL),
       'fn_shop_supplier_manual_record_v2'
UNION ALL SELECT 'fn_stage',
       (to_regprocedure('public.fn_shop_supplier_manual_stage_v2(uuid,uuid,text,text,text)') IS NOT NULL),
       'fn_shop_supplier_manual_stage_v2'
UNION ALL SELECT 'trigger_events_immutable',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_supplier_manual_events_immutable_v2' AND NOT tgisinternal),
       'tr_supplier_manual_events_immutable_v2'
UNION ALL SELECT 'rls_enabled',
       COALESCE((SELECT bool_and(relrowsecurity) FROM pg_class
                 WHERE oid IN ('public.shop_supplier_manual_purchases'::regclass,
                               'public.shop_supplier_manual_purchase_events'::regclass)), false),
       'row level security on both manual tables'
UNION ALL SELECT 'state_check_allows_confirmed_submission',
       COALESCE((SELECT position('(supplier_order_no IS NULL) = (actual_amount_cny IS NULL)' IN pg_get_constraintdef(oid)) > 0
                 FROM pg_constraint WHERE conname = 'shop_supplier_manual_purchase_state_check'), false),
       'confirmed state may carry a staged order number and amount'
UNION ALL SELECT 'service_role_only_execute',
       (SELECT count(*) = 5 FROM (
            SELECT p.proname,
                   has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc,
                   has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                   has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'fn_shop_supplier_manual_%_v2') g
        WHERE svc AND NOT auth AND NOT anon),
       'five manual functions executable by service_role only'
UNION ALL SELECT 'no_purchase_rows_seeded',
       (SELECT count(*) = 0 FROM public.shop_supplier_manual_purchases),
       'migration seeds no purchases'
UNION ALL SELECT 'no_manual_event_rows_seeded',
       (SELECT count(*) = 0 FROM public.shop_supplier_manual_purchase_events),
       'migration seeds no events'
ORDER BY check_id;
