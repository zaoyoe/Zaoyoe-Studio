-- Read-only fee verification; run manually after migration 10.
BEGIN READ ONLY;

DO $$
DECLARE v_signature TEXT; v_function OID; v_role TEXT; v_source TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM public.tg_purchase_quotes q JOIN public.tg_purchase_orders p ON p.quote_id = q.id
        WHERE p.total_minor IS DISTINCT FROM q.total_minor OR p.subtotal_minor IS DISTINCT FROM q.subtotal_minor
           OR p.payment_fee_minor IS DISTINCT FROM q.payment_fee_minor
           OR p.payment_fee_rate_bps IS DISTINCT FROM q.payment_fee_rate_bps
           OR (q.payment_channel IS NOT NULL AND p.payment_channel IS DISTINCT FROM q.payment_channel)) THEN
        RAISE EXCEPTION 'TG fee snapshot binding mismatch';
    END IF;
    IF (SELECT count(*) FROM pg_constraint WHERE conname IN ('tg_purchase_quotes_fees_check', 'tg_purchase_orders_fees_check')
        AND conrelid IN ('public.tg_purchase_quotes'::regclass, 'public.tg_purchase_orders'::regclass) AND convalidated) <> 2 THEN
        RAISE EXCEPTION 'TG fee constraints missing';
    END IF;
    IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_tg_purchase_quote_identity', 'trg_tg_purchase_order_identity')
        AND tgrelid IN ('public.tg_purchase_quotes'::regclass, 'public.tg_purchase_orders'::regclass) AND tgenabled = 'O') <> 2 THEN
        RAISE EXCEPTION 'TG immutable fee triggers missing';
    END IF;
    FOREACH v_signature IN ARRAY ARRAY[
        'public.fn_tg_purchase_quote(text,integer,integer,text)',
        'public.fn_tg_purchase_quote(text,integer,integer,text,text)',
        'public.fn_tg_create_purchase(uuid,text,text,bigint,bigint,bigint,character,character,text,text,text)',
        'public.tg_purchase_order_json(uuid)'
    ] LOOP
        v_function := to_regprocedure(v_signature);
        IF v_function IS NULL THEN RAISE EXCEPTION 'TG fee RPC missing: %', v_signature; END IF;
        FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF has_function_privilege(v_role, v_function, 'EXECUTE') THEN RAISE EXCEPTION 'unsafe TG fee RPC ACL'; END IF;
        END LOOP;
        IF NOT has_function_privilege('service_role', v_function, 'EXECUTE')
           OR EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               WHERE p.oid = v_function AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_function AND prosecdef
               AND proconfig @> ARRAY['search_path=public, pg_temp']::TEXT[]) THEN RAISE EXCEPTION 'invalid TG fee service definer'; END IF;
    END LOOP;
    SELECT pg_get_functiondef('public.fn_tg_create_purchase(uuid,text,text,bigint,bigint,bigint,character,character,text,text,text)'::regprocedure) INTO v_source;
    IF position('v_quote.payment_channel IS DISTINCT FROM p_payment_channel' IN v_source) = 0
        OR position('v_quote.payment_fee_minor' IN v_source) = 0 OR position('v_quote.payment_channel IS NULL' IN v_source) = 0 THEN
        RAISE EXCEPTION 'TG fee quote binding missing';
    END IF;
    SELECT pg_get_functiondef('public.tg_guard_purchase_identity()'::regprocedure) INTO v_source;
    IF position('NEW.payment_fee_minor IS DISTINCT FROM OLD.payment_fee_minor' IN v_source) = 0
        OR position('NEW.subtotal_minor IS DISTINCT FROM v_quote.subtotal_minor' IN v_source) = 0 THEN
        RAISE EXCEPTION 'TG immutable fee guard missing';
    END IF;
    SELECT pg_get_functiondef('public.fn_tg_confirm_purchase_payment(text,text,text,text,text,bigint,text,jsonb)'::regprocedure) INTO v_source;
    IF position('v_order.total_minor IS DISTINCT FROM p_amount_minor' IN v_source) = 0
        OR position('actually_paid' IN v_source) = 0 THEN RAISE EXCEPTION 'TG full settlement amount guard missing'; END IF;
    RAISE NOTICE 'TG fee schema, channel binding, immutable legacy amounts and service ACL verified';
END;
$$;

COMMIT;
