-- Operator-run, read-only structural verification. Does not exercise transactions.
-- Apply 20261017_tg_operations_closure.sql first; archive this output separately
-- from real concurrent callback/close/review acceptance evidence.
BEGIN READ ONLY;
DO $$
DECLARE v_signature TEXT; v_oid OID; v_source TEXT;
BEGIN
    FOREACH v_signature IN ARRAY ARRAY[
        'public.fn_tg_preview_code(character)',
        'public.fn_tg_close_purchase(text,character,uuid,timestamp with time zone,text)',
        'public.fn_tg_review_purchase(text,text,timestamp with time zone,uuid,text)',
        'public.fn_tg_review_order(uuid,text,timestamp with time zone,uuid,text,jsonb)'
    ] LOOP
        v_oid := to_regprocedure(v_signature);
        IF v_oid IS NULL THEN RAISE EXCEPTION 'Missing TG closure RPC: %', v_signature; END IF;
        IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
           OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'Invalid TG closure RPC grants: %', v_signature;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid AND prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']) THEN
            RAISE EXCEPTION 'Invalid TG closure security context: %', v_signature;
        END IF;
    END LOOP;
    SELECT pg_get_constraintdef(oid) INTO v_source FROM pg_constraint
    WHERE conrelid = 'public.tg_purchase_orders'::regclass AND conname = 'tg_purchase_orders_payment_status_check';
    IF v_source IS NULL OR position('cancelled' IN v_source) = 0 THEN RAISE EXCEPTION 'Cancelled payment state missing'; END IF;
    SELECT pg_get_functiondef('public.fn_tg_confirm_purchase_payment(text,text,text,text,text,bigint,text,jsonb)'::regprocedure) INTO v_source;
    IF position('payment_received_after_close' IN v_source) = 0 OR position('signed_notify_and_query' IN v_source) = 0
       OR position('tg_valid_purchase_crypto_checkout' IN v_source) = 0 THEN RAISE EXCEPTION 'Late payment / USDT guards missing'; END IF;
    SELECT pg_get_functiondef('public.fn_tg_finish_order(uuid,uuid,text,text,jsonb,text,text,timestamp with time zone)'::regprocedure) INTO v_source;
    IF position('purchase_binding_conflict' IN v_source) = 0 OR position('provider_completion_unconfirmed' IN v_source) = 0 THEN
        RAISE EXCEPTION 'Finalizer must retain cash-purchase and provider evidence guards';
    END IF;
    SELECT pg_get_functiondef('public.tg_purchase_order_json(uuid)'::regprocedure) INTO v_source;
    IF position('can_close' IN v_source) = 0 OR position('crypto_checkout' IN v_source) = 0 THEN
        RAISE EXCEPTION 'Purchase projection is missing closure or USDT data';
    END IF;
END;
$$;
SELECT 'TG operations structural checks passed; concurrent/business acceptance remains NOT RUN' AS result;
COMMIT;
