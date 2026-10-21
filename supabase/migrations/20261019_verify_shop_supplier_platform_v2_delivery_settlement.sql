-- P2D-1 STRUCTURE/default-off inspection only. Apply manually after its migration.
-- No fixture, merchant request, delivery, refund or decryption is performed.
BEGIN;
SET TRANSACTION READ ONLY;
DO $$
DECLARE
    v_table TEXT;
    v_role TEXT;
    v_required RECORD;
    v_function REGPROCEDURE;
    v_source TEXT;
    v_anchor TEXT;
BEGIN
    IF to_regclass('public.shop_supplier_delivery_verifications') IS NULL
        OR to_regclass('public.shop_supplier_delivery_receipts') IS NULL
        OR to_regclass('public.shop_supplier_delivery_access_events') IS NULL
        OR to_regprocedure('public.fn_shop_supplier_delivery_ticket_v2(uuid,text)') IS NULL
        OR to_regprocedure('public.fn_shop_supplier_record_delivery_v2(uuid,jsonb)') IS NULL
        OR to_regprocedure('public.fn_shop_supplier_customer_delivery_v2(uuid,text,uuid,text)') IS NULL
        OR to_regprocedure('public.fn_shop_supplier_operations_v2(text,text,integer,uuid,text,text)') IS NULL THEN
        RAISE EXCEPTION 'Supplier P2D-1 delivery migration is not ready';
    END IF;
    FOREACH v_table IN ARRAY ARRAY['shop_supplier_delivery_verifications','shop_supplier_delivery_receipts','shop_supplier_delivery_access_events'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = v_table AND c.relrowsecurity) THEN
            RAISE EXCEPTION 'Supplier delivery RLS missing: %',v_table;
        END IF;
        FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
            IF has_table_privilege(v_role,'public.' || v_table,'INSERT,UPDATE,DELETE,TRUNCATE')
                OR has_any_column_privilege(v_role,'public.' || v_table,'INSERT,UPDATE') THEN
                RAISE EXCEPTION 'Supplier delivery direct write privilege: %/%',v_role,v_table;
            END IF;
        END LOOP;
        IF NOT has_table_privilege('service_role','public.' || v_table,'SELECT')
            OR has_table_privilege('anon','public.' || v_table,'SELECT')
            OR has_table_privilege('authenticated','public.' || v_table,'SELECT')
            OR has_any_column_privilege('anon','public.' || v_table,'SELECT')
            OR has_any_column_privilege('authenticated','public.' || v_table,'SELECT') THEN
            RAISE EXCEPTION 'Supplier delivery read privilege mismatch: %',v_table;
        END IF;
    END LOOP;
    FOR v_required IN SELECT * FROM (VALUES
        ('shop_supplier_delivery_receipts','PRIMARY KEY (unit_id)'),
        ('shop_supplier_delivery_receipts','UNIQUE (intent_id)'),
        ('shop_supplier_delivery_receipts','UNIQUE (supplier_account_id, original_request_id)'),
        ('shop_supplier_delivery_receipts','UNIQUE (supplier_account_id, supplier_order_no)')
    ) AS required(table_name,definition) LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.' || v_required.table_name)
            AND pg_get_constraintdef(oid) = v_required.definition AND convalidated) THEN
            RAISE EXCEPTION 'Supplier delivery durable identity constraint missing: %',v_required.definition;
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid IN ('public.shop_supplier_delivery_verifications'::REGCLASS,
        'public.shop_supplier_delivery_receipts'::REGCLASS,'public.shop_supplier_delivery_access_events'::REGCLASS,
        'public.shop_supplier_procurement_intents'::REGCLASS,'public.shop_supplier_transaction_outbox'::REGCLASS)
        AND NOT convalidated) THEN RAISE EXCEPTION 'Supplier delivery constraints are unvalidated'; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shop_supplier_delivery_receipts'::REGCLASS
        AND conname = 'shop_supplier_delivery_sealed_check' AND POSITION('COALESCE' IN pg_get_constraintdef(oid)) > 0)
        OR NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.ux_supplier_delivery_content_owner_v2')
            AND indisunique AND indisvalid AND indisready AND pg_get_expr(indpred,indrelid) = '(disposition = ''delivered''::text)') THEN
        RAISE EXCEPTION 'Supplier delivery envelope/unique content protection missing';
    END IF;
    FOR v_required IN SELECT * FROM (VALUES
        ('tr_supplier_delivery_receipt_immutable_v2','shop_supplier_delivery_receipts','shop_supplier_delivery_receipt_immutable_v2'),
        ('tr_shop_supplier_native_order_guard_v2','shop_orders','shop_supplier_native_order_guard_v2'),
        ('tr_guest_supplier_native_order_guard_v2','guest_shop_orders','shop_supplier_native_order_guard_v2'),
        ('tr_shop_supplier_dispatch_native_guard_v2','shop_orders','shop_supplier_dispatch_native_guard_v2'),
        ('tr_guest_supplier_dispatch_native_guard_v2','guest_shop_orders','shop_supplier_dispatch_native_guard_v2')
    ) AS required(trigger_name,table_name,function_name) LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.' || v_required.table_name)
            AND tgname = v_required.trigger_name AND tgenabled IN ('O','A') AND NOT tgisinternal
            AND tgfoid = to_regprocedure('public.' || v_required.function_name || '()')::OID) THEN
            RAISE EXCEPTION 'Supplier delivery/native guard missing: %',v_required.trigger_name;
        END IF;
    END LOOP;
    FOR v_required IN SELECT * FROM (VALUES
        ('public.fn_shop_supplier_delivery_ticket_v2(uuid,text)',true),
        ('public.fn_shop_supplier_record_delivery_v2(uuid,jsonb)',true),
        ('public.fn_shop_supplier_customer_delivery_v2(uuid,text,uuid,text)',true),
        ('public.fn_shop_supplier_operations_v2(text,text,integer,uuid,text,text)',true),
        ('public.shop_supplier_delivery_receipt_immutable_v2()',false),
        ('public.shop_supplier_delivery_projection_matches_v2(text,jsonb)',false),
        ('public.shop_supplier_native_order_guard_v2()',false),
        ('public.shop_supplier_dispatch_native_guard_v2()',false)
    ) AS required(signature,service_rpc) LOOP
        v_function := to_regprocedure(v_required.signature);
        IF v_function IS NULL OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_function AND prosecdef
            AND 'search_path=public, pg_temp' = ANY(proconfig))
            OR has_function_privilege('anon',v_function,'EXECUTE')
            OR has_function_privilege('authenticated',v_function,'EXECUTE')
            OR has_function_privilege('service_role',v_function,'EXECUTE') IS DISTINCT FROM v_required.service_rpc THEN
            RAISE EXCEPTION 'Supplier delivery function privilege mismatch: %',v_required.signature;
        END IF;
    END LOOP;
    v_source := pg_get_functiondef('public.fn_shop_supplier_record_delivery_v2(uuid,jsonb)'::REGPROCEDURE);
    FOREACH v_anchor IN ARRAY ARRAY[
        'supplier_service_role_required','supplier_delivery_identity_conflict','supplier_delivery_result_conflict',
        '412c6c9277c684368548010f93001c9cf10a7b170fddcafc085f9a0171289fd9',
        'v_attempt.request_started_at IS NULL','v_proof.credential_ref IS DISTINCT FROM v_attempt.account_snapshot',
        'pg_advisory_xact_lock','cost_above_ceiling','duplicate_content','native_not_deliverable',
        'actual_cost_cny = v_cost','supplier_dispatch_version = supplier_dispatch_version + 1'
    ] LOOP
        IF POSITION(v_anchor IN v_source) = 0 THEN RAISE EXCEPTION 'Supplier delivery safety anchor missing: %',v_anchor; END IF;
    END LOOP;
    v_source := pg_get_functiondef('public.shop_supplier_dispatch_native_guard_v2()'::REGPROCEDURE);
    IF POSITION('supplier_dispatch_resolution_required' IN v_source) = 0
        OR POSITION('shop_supplier_delivery_projection_matches_v2' IN v_source) = 0
        OR POSITION('to_jsonb(NEW)' IN v_source) = 0
        OR POSITION('to_jsonb(OLD)' IN v_source) = 0 THEN
        RAISE EXCEPTION 'Supplier delivery exception weakened native financial guard';
    END IF;
    -- Existing states must agree with immutable evidence; a debit is a fact even
    -- when content is quarantined. The inspection performs no sample mutations.
    IF EXISTS (SELECT 1 FROM public.shop_supplier_delivery_receipts r
        JOIN public.shop_supplier_fulfillment_units u ON u.id = r.unit_id
        JOIN public.shop_supplier_procurement_intents i ON i.id = r.intent_id
        JOIN public.shop_supplier_dispatch_attempts a ON a.intent_id = i.id
        LEFT JOIN public.shop_orders o ON o.id = u.shop_order_id
        LEFT JOIN public.guest_shop_orders g ON g.id = u.guest_order_id
        WHERE i.unit_id IS DISTINCT FROM u.id OR r.supplier_account_id IS DISTINCT FROM u.supplier_account_id
            OR r.supplier_account_id IS DISTINCT FROM i.supplier_account_id OR a.supplier_account_id IS DISTINCT FROM i.supplier_account_id
            OR r.original_request_id IS DISTINCT FROM i.original_request_id OR r.original_request_id IS DISTINCT FROM a.original_request_id
            OR r.supplier_order_no IS DISTINCT FROM i.supplier_order_no OR r.supplier_order_no IS DISTINCT FROM a.supplier_order_no
            OR i.status <> 'accepted' OR a.state <> 'accepted' OR u.funding_state <> 'funded'
            OR i.actual_cost_cny IS DISTINCT FROM r.actual_cost_cny
            OR (r.disposition = 'delivered' AND (i.exposure_status <> 'not_reserved' OR i.reserved_cost_cny <> 0
                OR NOT public.shop_supplier_delivery_projection_matches_v2(
                    CASE WHEN u.funding_kind = 'points' THEN 'shop_orders' ELSE 'guest_shop_orders' END,
                    CASE WHEN u.funding_kind = 'points' THEN to_jsonb(o) ELSE to_jsonb(g) END)))
            OR (r.disposition = 'quarantined' AND (i.exposure_status <> 'held' OR i.reserved_cost_cny IS DISTINCT FROM u.cost_ceiling_cny)))
        OR EXISTS (SELECT 1 FROM public.shop_supplier_procurement_intents i
            LEFT JOIN public.shop_supplier_delivery_receipts r ON r.intent_id = i.id
            WHERE r.intent_id IS NULL AND i.actual_cost_cny IS NOT NULL) THEN
        RAISE EXCEPTION 'Supplier delivery cost/identity/native projection mismatch';
    END IF;
    -- The installation remains unqualified/default off. Runtime environment,
    -- key rotation, row locks and merchant acceptance require separate evidence.
    IF EXISTS (SELECT 1 FROM public.shop_supplier_transaction_policies WHERE dispatch_enabled OR checkout_enabled)
        OR EXISTS (SELECT 1 FROM public.shop_supplier_dispatch_verifications WHERE is_enabled)
        OR EXISTS (SELECT 1 FROM public.shop_supplier_delivery_verifications WHERE verified_at <= clock_timestamp()
            AND valid_until > clock_timestamp()) THEN
        RAISE EXCEPTION 'Supplier delivery is qualified/enabled; independent runtime acceptance is required';
    END IF;
END;
$$;
SELECT 'Supplier P2D-1 delivery structural checks passed; DB concurrency, key recovery, merchant and business acceptance remain NOT RUN' AS result;
COMMIT;
