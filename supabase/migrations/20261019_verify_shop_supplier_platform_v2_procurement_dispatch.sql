-- P2C STRUCTURE/default-off verification only. Run manually AFTER the migration.
-- No SQL fixture, network request, procurement, delivery or refund is executed.
BEGIN;
SET TRANSACTION READ ONLY;
DO $$
DECLARE
    v_table TEXT;
    v_role TEXT;
    v_function REGPROCEDURE;
    v_source TEXT;
    v_required RECORD;
    v_trigger RECORD;
BEGIN
    IF to_regprocedure('public.fn_shop_supplier_dispatch_v2(text,uuid,text,uuid,jsonb)') IS NULL
        OR to_regclass('public.shop_supplier_dispatch_attempts') IS NULL
        OR to_regclass('public.shop_supplier_dispatch_verifications') IS NULL
        OR to_regclass('public.shop_supplier_dispatch_events') IS NULL THEN
        RAISE EXCEPTION 'Supplier P2C procurement dispatch migration is not ready';
    END IF;
    FOREACH v_table IN ARRAY ARRAY['shop_supplier_dispatch_verifications', 'shop_supplier_dispatch_attempts',
        'shop_supplier_dispatch_events', 'shop_supplier_procurement_intents', 'shop_supplier_transaction_outbox',
        'shop_supplier_transaction_policies'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = v_table AND c.relrowsecurity) THEN
            RAISE EXCEPTION 'Supplier dispatch RLS missing: %', v_table;
        END IF;
        FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
            IF has_table_privilege(v_role, 'public.' || v_table, 'INSERT,UPDATE,DELETE,TRUNCATE')
                OR has_any_column_privilege(v_role, 'public.' || v_table, 'INSERT,UPDATE') THEN
                RAISE EXCEPTION 'Supplier dispatch direct write privilege: %/%', v_role, v_table;
            END IF;
        END LOOP;
        IF NOT has_table_privilege('service_role', 'public.' || v_table, 'SELECT')
            OR has_table_privilege('anon', 'public.' || v_table, 'SELECT')
            OR has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
            OR has_any_column_privilege('anon', 'public.' || v_table, 'SELECT')
            OR has_any_column_privilege('authenticated', 'public.' || v_table, 'SELECT') THEN
            RAISE EXCEPTION 'Supplier dispatch read privilege mismatch: %', v_table;
        END IF;
    END LOOP;
    FOR v_required IN SELECT * FROM (VALUES
        ('shop_supplier_transaction_policies', 'dispatch_enabled'),
        ('shop_orders', 'supplier_dispatch_version'), ('guest_shop_orders', 'supplier_dispatch_version')
    ) AS required(table_name, column_name) LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
            AND table_name = v_required.table_name AND column_name = v_required.column_name AND is_nullable = 'NO'
            AND column_default IN ('false', '0')) THEN
            RAISE EXCEPTION 'Supplier dispatch default-off/serialization column missing: %', v_required.table_name;
        END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shop_supplier_dispatch_attempts'::REGCLASS
        AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (intent_id)' AND convalidated)
        OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shop_supplier_dispatch_attempts'::REGCLASS
        AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (supplier_account_id, original_request_id)' AND convalidated)
        OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shop_supplier_dispatch_events'::REGCLASS
        AND contype = 'u' AND pg_get_constraintdef(oid) = 'UNIQUE (attempt_id, event_type, token_hash)' AND convalidated) THEN
        RAISE EXCEPTION 'Supplier dispatch durable identity/idempotency constraints missing';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid IN ('public.shop_supplier_dispatch_attempts'::REGCLASS,
        'public.shop_supplier_dispatch_events'::REGCLASS, 'public.shop_supplier_dispatch_verifications'::REGCLASS,
        'public.shop_supplier_procurement_intents'::REGCLASS, 'public.shop_supplier_transaction_outbox'::REGCLASS)
        AND NOT convalidated) THEN RAISE EXCEPTION 'Supplier dispatch constraints are unvalidated'; END IF;
    FOR v_required IN SELECT * FROM (VALUES
        ('tr_supplier_dispatch_immutable_v2', 'shop_supplier_dispatch_attempts', 'shop_supplier_dispatch_immutable_v2'),
        ('tr_shop_supplier_dispatch_native_guard_v2', 'shop_orders', 'shop_supplier_dispatch_native_guard_v2'),
        ('tr_guest_supplier_dispatch_native_guard_v2', 'guest_shop_orders', 'shop_supplier_dispatch_native_guard_v2'),
        ('tr_shop_supplier_native_order_guard_v2', 'shop_orders', 'shop_supplier_native_order_guard_v2'),
        ('tr_guest_supplier_native_order_guard_v2', 'guest_shop_orders', 'shop_supplier_native_order_guard_v2')
    ) AS required(trigger_name, table_name, function_name) LOOP
        SELECT t.* INTO v_trigger FROM pg_trigger t
            WHERE t.tgrelid = to_regclass('public.' || v_required.table_name) AND t.tgname = v_required.trigger_name;
        IF NOT FOUND OR v_trigger.tgenabled NOT IN ('O', 'A') OR v_trigger.tgisinternal
            OR v_trigger.tgfoid <> to_regprocedure('public.' || v_required.function_name || '()')::OID THEN
            RAISE EXCEPTION 'Supplier dispatch native/identity guard missing: %', v_required.trigger_name;
        END IF;
    END LOOP;
    FOREACH v_function IN ARRAY ARRAY[
        'public.fn_shop_supplier_dispatch_v2(text,uuid,text,uuid,jsonb)'::REGPROCEDURE,
        'public.shop_supplier_dispatch_ticket_v2(public.shop_supplier_dispatch_attempts)'::REGPROCEDURE,
        'public.shop_supplier_dispatch_immutable_v2()'::REGPROCEDURE,
        'public.shop_supplier_dispatch_native_guard_v2()'::REGPROCEDURE
    ] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_function AND prosecdef
            AND 'search_path=public, pg_temp' = ANY(proconfig))
            OR has_function_privilege('anon', v_function, 'EXECUTE')
            OR has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
            RAISE EXCEPTION 'Supplier dispatch function security mismatch: %', v_function;
        END IF;
        IF has_function_privilege('service_role', v_function, 'EXECUTE') IS DISTINCT FROM
            (v_function = 'public.fn_shop_supplier_dispatch_v2(text,uuid,text,uuid,jsonb)'::REGPROCEDURE) THEN
            RAISE EXCEPTION 'Supplier dispatch private helper grant mismatch: %', v_function;
        END IF;
    END LOOP;
    v_source := pg_get_functiondef('public.fn_shop_supplier_dispatch_v2(text,uuid,text,uuid,jsonb)'::REGPROCEDURE);
    FOREACH v_table IN ARRAY ARRAY[
        'supplier_service_role_required', 'supplier_dispatch_contract_unverified',
        '4b6dbbf3491c950baeb4860d85128dcd2493ff4a1d61490a0c02892864fb9cae',
        'v_policy.dispatch_enabled', 'v_proof.immutable_request_key_verified', 'v_proof.final_rejection_verified',
        'v_proof.atomic_cny_ceiling_verified', 'v_proof.credential_ref IS DISTINCT FROM v_account.credential_ref',
        'v_mapping.updated_at IS DISTINCT FROM v_unit.mapping_revision', 'v_intent.exposure_status <> ''held''',
        'v_attempt.lease_token IS DISTINCT FROM p_token', 'v_event.result_hash IS DISTINCT FROM v_result_hash',
        'p_result IS DISTINCT FROM v_expected', 'v_attempt.query_count >= 12', 'v_attempt.reconcile_deadline_at <= v_now',
        'supplier_dispatch_version = supplier_dispatch_version + 1', 'supplier_dispatch_result_conflict',
        'awaiting_reconciliation', 'awaiting_delivery'
    ] LOOP
        IF POSITION(v_table IN v_source) = 0 THEN RAISE EXCEPTION 'Supplier dispatch protocol anchor missing: %', v_table; END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM public.shop_supplier_dispatch_attempts a
        JOIN public.shop_supplier_procurement_intents i ON i.id = a.intent_id
        JOIN public.shop_supplier_fulfillment_units u ON u.id = i.unit_id
        WHERE a.original_request_id IS DISTINCT FROM i.original_request_id OR a.supplier_account_id IS DISTINCT FROM i.supplier_account_id
            OR i.supplier_account_id IS DISTINCT FROM u.supplier_account_id OR a.state IS DISTINCT FROM i.status
            OR a.supplier_order_no IS DISTINCT FROM i.supplier_order_no OR i.exposure_status <> 'held'
            OR i.reserved_cost_cny IS DISTINCT FROM u.cost_ceiling_cny OR i.actual_cost_cny IS NOT NULL)
        OR EXISTS (SELECT 1 FROM public.shop_supplier_dispatch_events WHERE event_type = 'result'
            AND result_hash IS DISTINCT FROM encode(sha256(convert_to(result::TEXT, 'UTF8')), 'hex')) THEN
        RAISE EXCEPTION 'Supplier dispatch identity, exposure, projection or evidence mismatch';
    END IF;
    -- This verifier certifies an unenabled slice, not an active merchant setup.
    IF EXISTS (SELECT 1 FROM public.shop_supplier_transaction_policies WHERE dispatch_enabled)
        OR EXISTS (SELECT 1 FROM public.shop_supplier_dispatch_verifications WHERE is_enabled) THEN
        RAISE EXCEPTION 'Supplier P2C is enabled; independent merchant/runtime acceptance is required';
    END IF;
END;
$$;
SELECT 'Supplier P2C dispatch structural/default-off checks passed; database transaction/concurrency/business/merchant acceptance remains NOT RUN' AS result;
ROLLBACK;
