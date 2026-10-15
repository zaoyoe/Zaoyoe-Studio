-- Eighth TG SQL. Run after the sixth and seventh TG migrations.
-- Strictly read-only: no provider requests, codes, quotes, orders or payments.
BEGIN READ ONLY;

DO $$
DECLARE
    v_table TEXT;
    v_signature TEXT;
    v_function OID;
    v_role TEXT;
    v_source TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['tg_purchase_products', 'tg_purchase_quotes', 'tg_purchase_orders',
        'tg_redemption_batches', 'tg_redemption_codes', 'tg_redemption_orders', 'tg_fulfillment_attempts', 'tg_audit_events'] LOOP
        IF to_regclass('public.' || v_table) IS NULL THEN
            RAISE EXCEPTION 'TG purchase table missing: %', v_table;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = ('public.' || v_table)::regclass AND c.relrowsecurity)
           OR has_table_privilege('anon', 'public.' || v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
           OR has_table_privilege('authenticated', 'public.' || v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
            RAISE EXCEPTION 'unsafe TG purchase table ACL or RLS: %', v_table;
        END IF;
    END LOOP;
    IF to_regclass('public.tg_purchase_order_stats') IS NULL
       OR has_table_privilege('anon', 'public.tg_purchase_order_stats', 'SELECT')
       OR has_table_privilege('authenticated', 'public.tg_purchase_order_stats', 'SELECT')
       OR NOT has_table_privilege('service_role', 'public.tg_purchase_order_stats', 'SELECT') THEN
        RAISE EXCEPTION 'unsafe or missing TG purchase statistics view';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tg_purchase_order_stats'
        AND column_name IN ('status_token_hash', 'idempotency_key_hash', 'checkout_lease_token', 'verified_payment', 'checkout_url')) THEN
        RAISE EXCEPTION 'TG purchase administrative view exposes private payment material';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name = 'tg_purchase_order_stats' AND column_name = 'price_version') THEN
        RAISE EXCEPTION 'TG purchase administrative view is missing price version';
    END IF;
    IF (SELECT count(*) FROM public.tg_purchase_products WHERE product_key IN ('premium_3', 'premium_6', 'premium_12', 'stars')) <> 4
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name = 'tg_purchase_products' AND column_name = 'enabled' AND column_default = 'false') THEN
        RAISE EXCEPTION 'TG purchase catalog or disabled-by-default guard missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tg_purchase_quotes'::regclass
        AND conname = 'tg_purchase_quotes_entitlement_check' AND contype = 'c' AND convalidated)
       OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tg_purchase_orders'::regclass
        AND conname = 'tg_purchase_orders_entitlement_check' AND contype = 'c' AND convalidated)
       OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tg_redemption_orders'::regclass
        AND conname = 'tg_redemption_orders_source_check' AND contype = 'c' AND convalidated)
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name = 'tg_redemption_orders' AND column_name = 'code_id' AND is_nullable = 'YES') THEN
        RAISE EXCEPTION 'TG purchase entitlement or source constraint missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_tg_purchase_orders_provider_trade') AND indisunique AND indisvalid)
       OR NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_tg_redemption_orders_purchase') AND indisunique AND indisvalid) THEN
        RAISE EXCEPTION 'TG payment trade or purchase fulfillment uniqueness missing';
    END IF;
    IF EXISTS (SELECT 1 FROM public.tg_purchase_orders p JOIN public.tg_purchase_quotes q ON q.id = p.quote_id
        WHERE p.product_key IS DISTINCT FROM q.product_key OR p.product_family IS DISTINCT FROM q.product_family
           OR p.term_months IS DISTINCT FROM q.term_months OR p.stars_quantity IS DISTINCT FROM q.stars_quantity
           OR p.telegram_username IS DISTINCT FROM q.telegram_username OR p.total_minor IS DISTINCT FROM q.total_minor
           OR p.currency IS DISTINCT FROM q.currency OR p.price_version IS DISTINCT FROM q.price_version)
       OR EXISTS (SELECT 1 FROM public.tg_redemption_orders o JOIN public.tg_purchase_orders p ON p.id = o.purchase_id
        WHERE o.order_source <> 'purchase' OR o.code_id IS NOT NULL OR p.payment_status <> 'paid' OR p.paid_at IS NULL
           OR o.product_family IS DISTINCT FROM p.product_family OR o.term_months IS DISTINCT FROM p.term_months
           OR o.stars_quantity IS DISTINCT FROM p.stars_quantity OR o.telegram_username IS DISTINCT FROM p.telegram_username)
       OR EXISTS (SELECT 1 FROM public.tg_redemption_orders o JOIN public.tg_redemption_codes c ON c.id = o.code_id
        JOIN public.tg_redemption_batches b ON b.id = c.batch_id
        WHERE o.order_source <> 'redemption' OR o.purchase_id IS NOT NULL
           OR o.product_family IS DISTINCT FROM b.product_family OR o.term_months IS DISTINCT FROM b.term_months
           OR o.stars_quantity IS DISTINCT FROM b.stars_quantity) THEN
        RAISE EXCEPTION 'existing TG purchase or redemption binding mismatch requires manual review';
    END IF;
    FOREACH v_signature IN ARRAY ARRAY[
        'public.fn_tg_generate_stars_batch(text,integer,integer,timestamp with time zone,uuid,jsonb,jsonb)',
        'public.fn_tg_reserve_code(text,text,character,character)',
        'public.fn_tg_order_status(text,character)',
        'public.fn_tg_update_price(text,bigint,bigint,boolean,uuid,bigint)',
        'public.tg_purchase_order_json(uuid)',
        'public.fn_tg_purchase_quote(text,integer,integer,text)',
        'public.fn_tg_create_purchase(uuid,text,text,bigint,bigint,bigint,character,character,text,text,text)',
        'public.fn_tg_claim_purchase_checkout(uuid,uuid,integer)',
        'public.fn_tg_save_purchase_checkout(uuid,uuid,text,text)',
        'public.fn_tg_fail_purchase_checkout(uuid,uuid,text)',
        'public.fn_tg_confirm_purchase_payment(text,text,text,text,text,bigint,text,jsonb)',
        'public.fn_tg_purchase_status(text,character)',
        'public.fn_tg_claim_fulfillment_order(uuid,uuid,integer,text[],text[])',
        'public.fn_tg_finish_order(uuid,uuid,text,text,jsonb,text,text,timestamp with time zone)',
        'public.fn_tg_claim_order(uuid,uuid,integer)',
        'public.fn_tg_claim_order(uuid,uuid,integer,text[])',
        'public.fn_tg_mark_submitted(uuid,uuid)',
        'public.fn_tg_mark_submitted(uuid,uuid,text)'
    ] LOOP
        v_function := to_regprocedure(v_signature);
        IF v_function IS NULL THEN RAISE EXCEPTION 'TG purchase RPC missing: %', v_signature; END IF;
        FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF has_function_privilege(v_role, v_function, 'EXECUTE') THEN
                RAISE EXCEPTION 'unsafe browser role % can invoke %', v_role, v_signature;
            END IF;
        END LOOP;
        IF NOT has_function_privilege('service_role', v_function, 'EXECUTE')
           OR EXISTS (SELECT 1 FROM pg_proc p,
            LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            WHERE p.oid = v_function AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_function AND p.prosecdef
            AND p.proconfig @> ARRAY['search_path=public, pg_temp']::TEXT[]) THEN
            RAISE EXCEPTION 'invalid TG purchase service-only definer RPC ACL: %', v_signature;
        END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tg_purchase_products'::regclass
        AND tgname = 'trg_tg_purchase_product' AND NOT tgisinternal AND tgenabled = 'O')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tg_purchase_quotes'::regclass
        AND tgname = 'trg_tg_purchase_quote_identity' AND NOT tgisinternal AND tgenabled = 'O')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tg_purchase_orders'::regclass
        AND tgname = 'trg_tg_purchase_order_identity' AND NOT tgisinternal AND tgenabled = 'O')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tg_redemption_orders'::regclass
        AND tgname = 'trg_tg_order_entitlement_identity' AND NOT tgisinternal AND tgenabled = 'O') THEN
        RAISE EXCEPTION 'TG purchase immutable identity triggers missing';
    END IF;
    SELECT pg_get_functiondef('public.fn_tg_create_purchase(uuid,text,text,bigint,bigint,bigint,character,character,text,text,text)'::regprocedure) INTO v_source;
    IF position('v_quote.product_key IS DISTINCT FROM p_expected_product_key' IN v_source) = 0
       OR position('v_quote.telegram_username IS DISTINCT FROM p_expected_username' IN v_source) = 0
       OR position('v_quote.total_minor IS DISTINCT FROM p_expected_total_minor' IN v_source) = 0
       OR position('v_quote.price_version IS DISTINCT FROM p_expected_price_version' IN v_source) = 0
       OR position('v_quote.stars_quantity IS DISTINCT FROM p_expected_stars_quantity' IN v_source) = 0
       OR position('quote_stale' IN v_source) = 0 OR position('pg_advisory_xact_lock' IN v_source) = 0 THEN
        RAISE EXCEPTION 'TG purchase quote/recipient/price binding missing';
    END IF;
    SELECT pg_get_functiondef('public.fn_tg_purchase_status(text,character)'::regprocedure) INTO v_source;
    IF position('v_order.payment_status = ''awaiting_payment'' AND v_order.paid_at IS NULL' IN v_source) = 0
       OR position('v_order.payment_expires_at <= now()' IN v_source) = 0
       OR position('v_order.checkout_lease_expires_at <= now()' IN v_source) = 0
       OR position('checkout_result_unknown' IN v_source) = 0
       OR position('SET payment_status = ''expired''' IN v_source) = 0 THEN
        RAISE EXCEPTION 'TG unpaid expiry status guard missing';
    END IF;
    SELECT pg_get_functiondef('public.fn_tg_confirm_purchase_payment(text,text,text,text,text,bigint,text,jsonb)'::regprocedure) INTO v_source;
    IF position('signed_notify' IN v_source) = 0
       OR position('v_order.total_minor IS DISTINCT FROM p_amount_minor' IN v_source) = 0
       OR position('v_order.payment_merchant_id IS DISTINCT FROM p_merchant_id' IN v_source) = 0
       OR position('v_order.payment_channel IS DISTINCT FROM p_payment_channel' IN v_source) = 0
       OR position('v_order.currency IS DISTINCT FROM p_currency' IN v_source) = 0
       OR position('payment_received_after_expiry' IN v_source) = 0
       OR position('tg-purchase-' IN v_source) = 0 THEN
        RAISE EXCEPTION 'TG signed payment, amount binding or late-payment guard missing';
    END IF;
    SELECT pg_get_functiondef('public.fn_tg_claim_fulfillment_order(uuid,uuid,integer,text[],text[])'::regprocedure) INTO v_source;
    IF position('cardinality(p_order_sources) = 0' IN v_source) = 0
       OR position('o.product_family = ANY(p_product_families)' IN v_source) = 0
       OR position('p.payment_status = ''paid''' IN v_source) = 0
       OR position('FOR UPDATE OF p SKIP LOCKED' IN v_source) = 0
       OR position('FOR UPDATE SKIP LOCKED' IN v_source) = 0
       OR position('v_order.attempt_count = 0' IN v_source) = 0
       OR position('provider_result_unknown' IN v_source) = 0 THEN
        RAISE EXCEPTION 'TG paid purchase claim capability or single-submission protection missing';
    END IF;
    SELECT pg_get_functiondef('public.fn_tg_mark_submitted(uuid,uuid,text)'::regprocedure) INTO v_source;
    IF position('SET submitted_at = now(), provider_payment_currency = p_payment_currency' IN v_source) = 0
       OR position('o.attempt_count = 1' IN v_source) = 0
       OR position('o.lease_expires_at > now()' IN v_source) = 0 THEN
        RAISE EXCEPTION 'TG single-submission currency marker missing';
    END IF;
    SELECT pg_get_functiondef('public.fn_tg_finish_order(uuid,uuid,text,text,jsonb,text,text,timestamp with time zone)'::regprocedure) INTO v_source;
    IF position('v_source = ''redemption''' IN v_source) = 0
       OR position('v_source = ''purchase''' IN v_source) = 0
       OR position('purchase_binding_conflict' IN v_source) = 0
       OR position('entitlement_binding_conflict' IN v_source) = 0
       OR position('v_snapshot->>''stars_quantity'' = v_order.stars_quantity::TEXT' IN v_source) = 0
       OR position('v_snapshot->>''verified_by'' = ''order_get''' IN v_source) = 0
       OR position('v_snapshot->>''currency'' = CASE v_order.provider_payment_currency' IN v_source) = 0
       OR position('WHEN ''gram'' THEN ''gram'' WHEN ''usdt'' THEN ''usd'' ELSE NULL END' IN v_source) = 0 THEN
        RAISE EXCEPTION 'TG source-aware completion lost exact product or saved-currency binding';
    END IF;
    RAISE NOTICE 'TG Stars and purchase schema, immutable binding, service ACL and single-submission guards verified';
END;
$$;

COMMIT;
