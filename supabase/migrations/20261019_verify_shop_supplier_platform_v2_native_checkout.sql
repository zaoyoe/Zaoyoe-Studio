-- READ ONLY structural evidence. Never creates a fixture/order or tests payment,
-- procurement, wallet transactions or concurrency. Run the P1 and P2A verifiers too.
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
DO $$
DECLARE
    v_required RECORD;
    v_oid OID;
BEGIN
    IF to_regclass('public.shop_supplier_checkout_quotes') IS NULL THEN
        RAISE EXCEPTION 'Supplier P2B native checkout migration is not ready';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.shop_supplier_checkout_quotes'::regclass AND relrowsecurity)
        OR has_table_privilege('anon', 'public.shop_supplier_checkout_quotes', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_table_privilege('authenticated', 'public.shop_supplier_checkout_quotes', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_table_privilege('service_role', 'public.shop_supplier_checkout_quotes', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR NOT has_table_privilege('service_role', 'public.shop_supplier_checkout_quotes', 'SELECT')
        OR has_any_column_privilege('anon', 'public.shop_supplier_checkout_quotes', 'SELECT,INSERT,UPDATE,REFERENCES')
        OR has_any_column_privilege('authenticated', 'public.shop_supplier_checkout_quotes', 'SELECT,INSERT,UPDATE,REFERENCES')
        OR has_any_column_privilege('service_role', 'public.shop_supplier_checkout_quotes', 'INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'Supplier P2B quote RLS/ACL is not private';
    END IF;
    FOR v_required IN SELECT * FROM (VALUES
        ('shop_orders', 'fulfillment_source', '''local''::text'),
        ('guest_shop_orders', 'fulfillment_source', '''local''::text'),
        ('shop_supplier_transaction_policies', 'checkout_enabled', 'false')
    ) r(table_name, column_name, default_value) LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public'
            AND c.table_name = v_required.table_name AND c.column_name = v_required.column_name
            AND c.is_nullable = 'NO' AND c.column_default = v_required.default_value) THEN
            RAISE EXCEPTION 'Supplier P2B native column/default missing: %.%', v_required.table_name, v_required.column_name;
        END IF;
    END LOOP;
    FOR v_required IN SELECT * FROM (VALUES
        ('fn_shop_supplier_source_v2(uuid,uuid,text)', true, 'shop_supplier_has_source_v2'),
        ('fn_issue_shop_supplier_quote_v2(uuid,text,uuid,text,uuid,uuid,text)', true, 'supplier_quote_expired'),
        ('fn_purchase_shop_supplier_points_v2(uuid,uuid)', true, 'fn_purchase_shop_item_core'),
        ('fn_create_shop_supplier_guest_order_v2(uuid,text,uuid,uuid,text,text,text,text,text,text,uuid,text,text,integer,integer,text)', true, 'native_params_hash'),
        ('shop_supplier_has_source_v2(uuid,uuid)', false, 'contract_version = 2'),
        ('shop_supplier_checkout_context_v2(uuid,uuid,text,uuid)', false, 'FOR UPDATE'),
        ('shop_supplier_native_order_guard_v2()', false, 'supplier_source_immutable'),
        ('shop_supplier_local_stock_guard_v2()', false, 'supplier_local_fulfillment_forbidden'),
        ('shop_supplier_assert_native_binding_v2()', false, 'supplier_native_binding_required')
    ) r(signature, service_allowed, marker) LOOP
        v_oid := to_regprocedure('public.' || v_required.signature);
        IF v_oid IS NULL THEN RAISE EXCEPTION 'Supplier P2B function missing: %', v_required.signature; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid AND prosecdef
            AND proconfig @> ARRAY['search_path=public, pg_temp']::TEXT[])
            OR has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
            OR has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM v_required.service_allowed
            OR POSITION(v_required.marker IN pg_get_functiondef(v_oid)) = 0 THEN
            RAISE EXCEPTION 'Supplier P2B function ACL/body invalid: %', v_required.signature;
        END IF;
    END LOOP;
    FOR v_required IN SELECT * FROM (VALUES
        ('shop_orders', 'tr_shop_supplier_native_order_guard_v2', 'shop_supplier_native_order_guard_v2()', 23, false),
        ('guest_shop_orders', 'tr_guest_supplier_native_order_guard_v2', 'shop_supplier_native_order_guard_v2()', 23, false),
        ('guest_shop_checkout_items', 'tr_supplier_batch_stock_guard_v2', 'shop_supplier_local_stock_guard_v2()', 23, false),
        ('guest_shop_inventory_reservations', 'tr_supplier_guest_stock_guard_v2', 'shop_supplier_local_stock_guard_v2()', 23, false),
        ('shop_order_items', 'tr_supplier_points_stock_guard_v2', 'shop_supplier_local_stock_guard_v2()', 23, false),
        ('shop_orders', 'tr_supplier_points_binding_commit_v2', 'shop_supplier_assert_native_binding_v2()', 5, true),
        ('guest_shop_orders', 'tr_supplier_guest_binding_commit_v2', 'shop_supplier_assert_native_binding_v2()', 5, true)
    ) r(table_name, trigger_name, signature, expected_type, deferred) LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.' || v_required.table_name)
            AND tgname = v_required.trigger_name AND tgfoid = to_regprocedure('public.' || v_required.signature)
            AND tgtype = v_required.expected_type AND NOT tgisinternal AND tgenabled IN ('O', 'A')
            AND tgdeferrable = v_required.deferred AND tginitdeferred = v_required.deferred
            AND ((tgconstraint <> 0) = v_required.deferred)) THEN
            RAISE EXCEPTION 'Supplier P2B guard/binding trigger missing: %', v_required.trigger_name;
        END IF;
    END LOOP;
    FOR v_required IN SELECT * FROM (VALUES
        ('fn_purchase_shop_item_core(uuid,uuid,character varying,integer,character varying,uuid,uuid)', 'supplier-native-core-v2'),
        ('fn_purchase_shop_item_core(uuid,uuid,character varying,integer,character varying,uuid,uuid)', 'PERFORM public.fn_consume_wallet_point_lots_for_shop_order('),
        ('fn_purchase_shop_item_core(uuid,uuid,character varying,integer,character varying,uuid,uuid)', 'v_spent_paid_points'),
        ('fn_purchase_shop_item_core(uuid,uuid,character varying,integer,character varying,uuid,uuid)', 'IF v_total_price > 0 AND v_supplier_quote.id IS NULL THEN'),
        ('fn_guest_shop_create_order(text,uuid,uuid,text,text,text,text,text,text,uuid,text,text,integer,integer,text)', 'supplier-native-guest-v2'),
        ('fn_guest_shop_create_order(text,uuid,uuid,text,text,text,text,text,text,uuid,text,text,integer,integer,text)', 'guest_shop_resolve_credit_unit_amount_with_start('),
        ('fn_guest_shop_create_order(text,uuid,uuid,text,text,text,text,text,text,uuid,text,text,integer,integer,text)', 'guest_payment_channel_unavailable'),
        ('fn_guest_shop_confirm_payment(uuid,uuid,text,text,text,text,numeric,text,text,boolean,boolean,boolean,boolean)', 'supplier-native-payment-v2'),
        ('fn_guest_shop_confirm_payment(uuid,uuid,text,text,text,text,numeric,text,text,boolean,boolean,boolean,boolean)', 'amount_verified = true'),
        ('fn_guest_shop_confirm_payment(uuid,uuid,text,text,text,text,numeric,text,text,boolean,boolean,boolean,boolean)', 'processing_status = ''processed'''),
        ('shop_supplier_capture_funding_v2(uuid)', 'supplier-native-fee-v2'),
        ('shop_supplier_capture_funding_v2(uuid)', 'supplier_guest_verified_event_required'),
        ('fn_guest_shop_claim_fulfillment(uuid,uuid)', 'supplier-native-local-worker-guard-v2'),
        ('fn_guest_shop_mark_fulfilled(uuid,uuid)', 'supplier-native-local-worker-guard-v2'),
        ('fn_guest_shop_list_delivered_content(uuid)', 'supplier-native-local-worker-guard-v2')
    ) r(signature, marker) LOOP
        v_oid := to_regprocedure('public.' || v_required.signature);
        IF v_oid IS NULL OR POSITION(v_required.marker IN pg_get_functiondef(v_oid)) = 0 THEN
            RAISE EXCEPTION 'Supplier P2B installed native hook missing: % / %', v_required.signature, v_required.marker;
        END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = 'public.shop_supplier_checkout_quotes'::regclass
        AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indnkeyatts = 1
        AND pg_get_indexdef(i.indexrelid, 1, true) = 'operation_id') THEN
        RAISE EXCEPTION 'Supplier P2B quote operation uniqueness missing';
    END IF;
    IF EXISTS (SELECT 1 FROM public.shop_supplier_checkout_quotes q
        LEFT JOIN public.shop_supplier_fulfillment_units u ON u.operation_id = q.operation_id
        WHERE q.status = 'consumed' AND (u.id IS NULL OR u.product_id IS DISTINCT FROM q.product_id
            OR u.sku_id IS DISTINCT FROM q.sku_id OR u.shop_order_id IS DISTINCT FROM q.shop_order_id
            OR u.guest_order_id IS DISTINCT FROM q.guest_order_id)) THEN
        RAISE EXCEPTION 'Supplier P2B consumed quote/native funding binding inconsistent';
    END IF;
    IF EXISTS (SELECT 1 FROM public.shop_supplier_transaction_policies WHERE checkout_enabled)
        OR EXISTS (SELECT 1 FROM public.shop_supplier_transaction_outbox WHERE status <> 'blocked')
        OR EXISTS (SELECT 1 FROM public.shop_supplier_procurement_intents WHERE status <> 'not_submitted'
            OR actual_cost_cny IS NOT NULL OR supplier_order_no IS NOT NULL) THEN
        RAISE EXCEPTION 'Supplier P2B must remain default-off without procurement';
    END IF;
END;
$$;
SELECT 'Supplier P2B native checkout structural checks passed; database transaction/concurrency/business/merchant acceptance remains NOT RUN' AS result;
COMMIT;
