-- Operator-run read-only verification, AFTER 20261017_tg_runtime_reconciliation.sql.
-- Structural evidence only; no orders, callbacks, switches or refunds are exercised.
BEGIN READ ONLY;
DO $$
DECLARE v_signature TEXT; v_oid OID; v_source TEXT; v_required TEXT;
BEGIN
    FOREACH v_signature IN ARRAY ARRAY[
        'public.tg_purchase_order_json(uuid)',
        'public.fn_tg_purchase_network_quote(uuid)',
        'public.fn_tg_bind_purchase_network_quote(uuid,text)',
        'public.fn_tg_save_purchase_crypto_checkout(uuid,uuid,text,jsonb)',
        'public.fn_tg_confirm_purchase_payment(text,text,text,text,text,bigint,text,jsonb)',
        'public.fn_tg_close_purchase(text,character,uuid,timestamp with time zone,text)',
        'public.fn_tg_review_purchase(text,text,timestamp with time zone,uuid,text)',
        'public.fn_tg_review_order(uuid,text,timestamp with time zone,uuid,text,jsonb)'
    ] LOOP
        v_oid := to_regprocedure(v_signature);
        IF v_oid IS NULL THEN RAISE EXCEPTION 'Missing reconciled TG RPC: %', v_signature; END IF;
        IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
           OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'Invalid reconciled TG RPC grants: %', v_signature;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid AND prosecdef AND proconfig @> ARRAY['search_path=public, pg_temp']) THEN
            RAISE EXCEPTION 'Invalid reconciled TG security context: %', v_signature;
        END IF;
    END LOOP;
    IF NOT public.fn_tg_purchase_resolution_ready() THEN RAISE EXCEPTION 'Purchase resolution is not ready'; END IF;
    v_oid := to_regprocedure('public.tg_valid_purchase_crypto_checkout(jsonb)');
    IF v_oid IS NULL THEN RAISE EXCEPTION 'Crypto validator is missing'; END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN RAISE EXCEPTION 'Invalid validator grants'; END IF;
    v_source := pg_get_functiondef(v_oid);
    FOREACH v_required IN ARRAY ARRAY['usdtbsc', 'usdtton', 'usdtmatic', 'usdttrc20', 'payin_extra_id', 'price_currency', 'price_amount_minor'] LOOP
        IF position(v_required IN v_source) = 0 THEN RAISE EXCEPTION 'Missing crypto validator guard: %', v_required; END IF;
    END LOOP;
    v_source := pg_get_functiondef('public.fn_tg_save_purchase_crypto_checkout(uuid,uuid,text,jsonb)'::regprocedure);
    FOREACH v_required IN ARRAY ARRAY['payment_network_mismatch', 'tg_purchase_network_quotes', 'v_order.closed_at IS NOT NULL', 'v_order.cancelled_at IS NOT NULL', 'lease_lost'] LOOP
        IF position(v_required IN v_source) = 0 THEN RAISE EXCEPTION 'Missing checkout guard: %', v_required; END IF;
    END LOOP;
    v_source := pg_get_functiondef('public.fn_tg_confirm_purchase_payment(text,text,text,text,text,bigint,text,jsonb)'::regprocedure);
    FOREACH v_required IN ARRAY ARRAY[
        'authenticated_query', 'signed_notify_and_query', 'checkout_trade_no', 'pg_advisory_xact_lock', 'FOR UPDATE',
        'payment_received_after_close', 'payment_received_after_cancellation', 'payment_received_after_expiry',
        'v_order.closed_at IS NOT NULL', 'v_order.cancelled_at IS NOT NULL', 'tg_valid_purchase_crypto_checkout',
        'v_order.crypto_checkout->>''price_currency''', 'v_order.crypto_checkout->>''pay_currency''', 'actually_paid_currency', 'payin_extra_id'
    ] LOOP
        IF position(v_required IN v_source) = 0 THEN RAISE EXCEPTION 'Missing settlement guard: %', v_required; END IF;
    END LOOP;
    v_source := pg_get_functiondef('public.tg_purchase_order_json(uuid)'::regprocedure);
    FOREACH v_required IN ARRAY ARRAY['subtotal_minor', 'payment_fee_minor', 'payment_fee_rate_bps', 'price_version', 'crypto_checkout', 'closed_at', 'can_close'] LOOP
        IF position(v_required IN v_source) = 0 THEN RAISE EXCEPTION 'Missing purchase projection: %', v_required; END IF;
    END LOOP;
    v_source := pg_get_functiondef('public.fn_tg_review_purchase(text,text,timestamp with time zone,uuid,text)'::regprocedure);
    IF position('payment_recheck_required' IN v_source) = 0 OR position('INSERT INTO public.tg_redemption_orders' IN v_source) > 0 THEN
        RAISE EXCEPTION 'Legacy approval must require the provider-rechecked review path';
    END IF;
    v_source := pg_get_functiondef('public.fn_tg_review_order(uuid,text,timestamp with time zone,uuid,text,jsonb)'::regprocedure);
    IF position('v_purchase.closed_at IS NOT NULL' IN v_source) = 0 THEN RAISE EXCEPTION 'Closed purchase guard is missing'; END IF;
    v_source := pg_get_functiondef('public.fn_tg_close_purchase(text,character,uuid,timestamp with time zone,text)'::regprocedure);
    IF position('cancelled_at = coalesce(cancelled_at, now())' IN v_source) = 0 THEN RAISE EXCEPTION 'Cancellation marker is missing'; END IF;
END;
$$;
SELECT 'TG reconciled runtime structural checks passed; concurrent/business acceptance remains NOT RUN' AS result;
COMMIT;
