-- Structural evidence only. This script does not perform a purchase, debit,
-- fixture INSERT, policy enablement, concurrent session or merchant request.
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
DO $$
DECLARE
    v_bind OID := to_regprocedure('public.fn_bind_shop_supplier_funding_v2(text,uuid,uuid,uuid,uuid,timestamp with time zone,numeric,uuid)');
    v_capture OID := to_regprocedure('public.shop_supplier_capture_funding_v2(uuid)');
    v_unit_trigger OID := to_regprocedure('public.shop_supplier_funding_boundary_v2()');
    v_payment_trigger OID := to_regprocedure('public.shop_supplier_guest_payment_boundary_v2()');
    v_oid OID;
    v_table TEXT;
    v_required RECORD;
    v_definition TEXT;
BEGIN
    IF v_bind IS NULL OR v_capture IS NULL OR v_unit_trigger IS NULL OR v_payment_trigger IS NULL THEN
        RAISE EXCEPTION 'Supplier P2A funding boundary migration is not ready';
    END IF;
    FOREACH v_table IN ARRAY ARRAY['shop_supplier_transaction_policies', 'shop_supplier_fulfillment_units',
        'shop_supplier_procurement_intents', 'shop_supplier_transaction_outbox', 'shop_supplier_transaction_events'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.' || v_table) AND relrowsecurity) THEN
            RAISE EXCEPTION 'Supplier P2A private table/RLS missing: %', v_table;
        END IF;
        IF has_table_privilege('anon', 'public.' || v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR has_table_privilege('authenticated', 'public.' || v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR has_table_privilege('service_role', 'public.' || v_table, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR NOT has_table_privilege('service_role', 'public.' || v_table, 'SELECT') THEN
            RAISE EXCEPTION 'Supplier P2A table privileges are not private/read-only: %', v_table;
        END IF;
        -- Column-level grants can survive a table-level REVOKE. Detect them too.
        IF has_any_column_privilege('anon', 'public.' || v_table, 'SELECT,INSERT,UPDATE,REFERENCES')
            OR has_any_column_privilege('authenticated', 'public.' || v_table, 'SELECT,INSERT,UPDATE,REFERENCES')
            OR has_any_column_privilege('service_role', 'public.' || v_table, 'INSERT,UPDATE,REFERENCES') THEN
            RAISE EXCEPTION 'Supplier P2A unexpected column grants: %', v_table;
        END IF;
    END LOOP;
    FOREACH v_oid IN ARRAY ARRAY[v_bind, v_capture, v_unit_trigger, v_payment_trigger] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid AND prosecdef
            AND proconfig @> ARRAY['search_path=public, pg_temp']::TEXT[]) THEN
            RAISE EXCEPTION 'Supplier P2A functions require fixed SECURITY DEFINER search paths';
        END IF;
        IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
            OR (v_oid = v_bind AND NOT has_function_privilege('service_role', v_oid, 'EXECUTE'))
            OR (v_oid <> v_bind AND has_function_privilege('service_role', v_oid, 'EXECUTE')) THEN
            RAISE EXCEPTION 'Supplier P2A function privileges are not restricted';
        END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_shop_supplier_funding_boundary_v2'
        AND tgrelid = 'public.shop_supplier_fulfillment_units'::regclass AND tgfoid = v_unit_trigger
        AND tgtype = 5 AND tgconstraint <> 0 AND tgdeferrable AND tginitdeferred
        AND NOT tgisinternal AND tgenabled IN ('O', 'A'))
        OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_shop_supplier_guest_payment_boundary_v2'
        AND tgrelid = 'public.guest_shop_payment_orders'::regclass AND tgfoid = v_payment_trigger
        AND tgtype = 17 AND tgconstraint <> 0 AND tgdeferrable AND tginitdeferred
        AND NOT tgisinternal AND tgenabled IN ('O', 'A')
        AND POSITION('confirmed' IN pg_get_triggerdef(oid)) > 0
        AND POSITION('IS DISTINCT FROM' IN pg_get_triggerdef(oid)) > 0) THEN
        RAISE EXCEPTION 'Supplier P2A deferred funding triggers are not ready';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shop_supplier_fulfillment_units'::regclass
        AND conname = 'shop_supplier_unit_points_item_fk' AND contype = 'f'
        AND confrelid = 'public.shop_order_items'::regclass AND confdeltype = 'r' AND convalidated
        AND ARRAY(SELECT a.attname::TEXT FROM unnest(conkey) WITH ORDINALITY k(attnum, pos)
            JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k.attnum ORDER BY k.pos) = ARRAY['shop_order_id', 'shop_order_item_id']::TEXT[]
        AND ARRAY(SELECT a.attname::TEXT FROM unnest(confkey) WITH ORDINALITY k(attnum, pos)
            JOIN pg_attribute a ON a.attrelid = confrelid AND a.attnum = k.attnum ORDER BY k.pos) = ARRAY['order_id', 'id']::TEXT[])
        OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shop_supplier_fulfillment_units'::regclass
        AND conname = 'shop_supplier_unit_sku_product_fk' AND contype = 'f'
        AND confrelid = 'public.shop_product_skus'::regclass AND confdeltype = 'r' AND convalidated
        AND ARRAY(SELECT a.attname::TEXT FROM unnest(conkey) WITH ORDINALITY k(attnum, pos)
            JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k.attnum ORDER BY k.pos) = ARRAY['product_id', 'sku_id']::TEXT[]
        AND ARRAY(SELECT a.attname::TEXT FROM unnest(confkey) WITH ORDINALITY k(attnum, pos)
            JOIN pg_attribute a ON a.attrelid = confrelid AND a.attnum = k.attnum ORDER BY k.pos) = ARRAY['product_id', 'id']::TEXT[])
        OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shop_supplier_fulfillment_units'::regclass
        AND conname = 'shop_supplier_unit_native_owner_check' AND contype = 'c' AND convalidated)
        OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shop_supplier_fulfillment_units'::regclass
        AND conname = 'shop_supplier_unit_funding_proof_check' AND contype = 'c' AND convalidated) THEN
        RAISE EXCEPTION 'Supplier P2A native order/product/proof constraints are not ready';
    END IF;
    FOR v_required IN SELECT * FROM (VALUES
        ('shop_supplier_fulfillment_units', 'shop_supplier_unit_operation_unique', ARRAY['operation_id']),
        ('shop_supplier_fulfillment_units', 'shop_supplier_unit_points_order_unique', ARRAY['shop_order_id']),
        ('shop_supplier_fulfillment_units', 'shop_supplier_unit_points_item_unique', ARRAY['shop_order_item_id']),
        ('shop_supplier_fulfillment_units', 'shop_supplier_unit_guest_order_unique', ARRAY['guest_order_id']),
        ('shop_supplier_fulfillment_units', 'shop_supplier_unit_points_ledger_unique', ARRAY['points_ledger_id']),
        ('shop_supplier_fulfillment_units', 'shop_supplier_unit_guest_payment_unique', ARRAY['guest_payment_order_id']),
        ('shop_supplier_procurement_intents', 'shop_supplier_intent_unit_unique', ARRAY['unit_id']),
        ('shop_supplier_procurement_intents', 'shop_supplier_intent_request_unique', ARRAY['supplier_account_id', 'original_request_id']),
        ('shop_supplier_transaction_outbox', 'shop_supplier_outbox_intent_unique', ARRAY['intent_id']),
        ('shop_supplier_transaction_events', 'shop_supplier_event_type_unique', ARRAY['unit_id', 'event_type'])
    ) AS required(table_name, constraint_name, column_names) LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_index i ON i.indexrelid = c.conindid
            WHERE c.conrelid = to_regclass('public.' || v_required.table_name) AND c.conname = v_required.constraint_name
            AND c.contype = 'u' AND c.convalidated AND NOT c.condeferrable AND i.indisunique AND i.indisvalid
            AND ARRAY(SELECT a.attname::TEXT FROM unnest(c.conkey) WITH ORDINALITY k(attnum, pos)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum ORDER BY k.pos) = v_required.column_names) THEN
            RAISE EXCEPTION 'Supplier P2A idempotency/proof uniqueness missing: %', v_required.constraint_name;
        END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('public.ux_shop_supplier_intent_upstream_order')
        AND i.indrelid = 'public.shop_supplier_procurement_intents'::regclass AND i.indisunique AND i.indisvalid
        AND i.indnkeyatts = 2 AND i.indnatts = 2
        AND ARRAY(SELECT a.attname::TEXT FROM unnest(i.indkey) WITH ORDINALITY k(attnum, pos)
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum ORDER BY k.pos)
            = ARRAY['supplier_account_id', 'supplier_order_no']::TEXT[]
        AND pg_get_expr(i.indpred, i.indrelid) = '(supplier_order_no IS NOT NULL)') THEN
        RAISE EXCEPTION 'Supplier P2A upstream order identity index missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name = 'shop_supplier_transaction_policies' AND column_name = 'intake_enabled'
        AND is_nullable = 'NO' AND column_default = 'false')
        OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name = 'shop_supplier_transaction_policies' AND column_name = 'budget_version'
        AND data_type = 'bigint' AND is_nullable = 'NO' AND column_default IN ('0', '0::bigint', '''0''::bigint'))
        OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name = 'shop_supplier_procurement_intents' AND column_name = 'actual_cost_cny'
        AND is_nullable = 'YES' AND column_default IS NULL) THEN
        RAISE EXCEPTION 'Supplier P2A default-off intake / budget serialization / unknown-cost contract missing';
    END IF;
    FOR v_required IN SELECT * FROM (VALUES
        ('shop_supplier_procurement_intents', 'shop_supplier_intent_status_check', 'not_submitted'),
        ('shop_supplier_procurement_intents', 'shop_supplier_intent_unsubmitted_check', 'actual_cost_cny IS NULL'),
        ('shop_supplier_transaction_outbox', 'shop_supplier_outbox_status_check', 'blocked')
    ) AS required(table_name, constraint_name, required_marker) LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint c
            WHERE c.conrelid = to_regclass('public.' || v_required.table_name) AND c.conname = v_required.constraint_name
            AND c.contype = 'c' AND c.convalidated AND POSITION(v_required.required_marker IN pg_get_constraintdef(c.oid)) > 0) THEN
            RAISE EXCEPTION 'Supplier P2A non-executable state constraint missing: %', v_required.constraint_name;
        END IF;
    END LOOP;
    v_definition := pg_get_functiondef(v_bind);
    IF POSITION('supplier_binding_must_precede_points_debit' IN v_definition) = 0
        OR POSITION('supplier_idempotency_conflict' IN v_definition) = 0
        OR POSITION('pg_advisory_xact_lock' IN v_definition) = 0
        OR POSITION('supplier_mapping_changed_or_unavailable' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Supplier P2A binding identity/transaction guards missing';
    END IF;
    v_definition := pg_get_functiondef(v_capture);
    IF POSITION('FOR UPDATE' IN v_definition) = 0 OR POSITION('FOR SHARE' IN v_definition) = 0
        OR POSITION('budget_version = budget_version + 1' IN v_definition) = 0
        OR POSITION('supplier_points_debit_required_in_transaction' IN v_definition) = 0
        OR POSITION('supplier_guest_verified_event_required' IN v_definition) = 0
        OR POSITION('supplier_risk_budget_unavailable' IN v_definition) = 0
        OR POSITION('risk_budget_unavailable' IN v_definition) = 0
        OR POSITION('shop_supplier_transaction_outbox' IN v_definition) = 0
        OR POSITION('funding_captured' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Supplier P2A funding/budget/outbox/audit hooks missing';
    END IF;
    IF EXISTS (SELECT 1 FROM public.shop_supplier_transaction_outbox WHERE status <> 'blocked')
        OR EXISTS (SELECT 1 FROM public.shop_supplier_procurement_intents
            WHERE status <> 'not_submitted' OR actual_cost_cny IS NOT NULL OR supplier_order_no IS NOT NULL) THEN
        RAISE EXCEPTION 'Supplier P2A must not contain an executable or submitted procurement';
    END IF;
    IF EXISTS (SELECT 1 FROM public.shop_supplier_fulfillment_units u
        LEFT JOIN public.shop_supplier_procurement_intents i ON i.unit_id = u.id
        LEFT JOIN public.shop_supplier_transaction_outbox o ON o.intent_id = i.id
        WHERE (u.funding_state = 'funded' AND (i.id IS NULL OR o.id IS NULL
            OR i.supplier_account_id IS DISTINCT FROM u.supplier_account_id
            OR i.request_fingerprint IS DISTINCT FROM u.request_fingerprint
            OR (i.exposure_status = 'held' AND i.reserved_cost_cny IS DISTINCT FROM u.cost_ceiling_cny)
            OR NOT EXISTS (SELECT 1 FROM public.shop_supplier_transaction_events e
                WHERE e.unit_id = u.id AND e.event_type = 'funding_captured')))
            OR (u.funding_state = 'awaiting_payment' AND i.id IS NOT NULL)) THEN
        RAISE EXCEPTION 'Supplier P2A funding/intent/outbox/audit records are inconsistent';
    END IF;
END;
$$;
SELECT 'Supplier P2A funding boundary structural checks passed; database transaction/concurrency/merchant acceptance remains NOT RUN' AS result;
COMMIT;
