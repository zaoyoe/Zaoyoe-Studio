-- Operator-only read-only verification after native-pricing migration.
BEGIN READ ONLY;
DO $$
DECLARE v_source TEXT; v_checkout JSONB; v_name TEXT;
BEGIN
    IF public.fn_tg_usdt_pricing_contract() IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'TG native-pricing contract not ready';
    END IF;
    v_checkout := jsonb_build_object('payment_id', '1', 'network', 'BSC (BEP20)',
        'pay_currency', 'usdtbsc', 'price_currency', 'usdtbsc', 'price_amount_minor', 1086,
        'pay_amount', '10.86', 'pay_address', '0x' || repeat('a', 40),
        'quote_expires_at', '2099-01-01T00:00:00.000Z');
    IF NOT public.tg_valid_purchase_crypto_checkout(v_checkout)
       OR public.tg_valid_purchase_crypto_checkout(jsonb_set(v_checkout, '{pay_amount}', '"10.860000000000000001"'))
       OR public.tg_valid_purchase_crypto_checkout(jsonb_set(v_checkout, '{pay_amount}', '"10.859999999999999999"'))
       OR public.tg_valid_purchase_crypto_checkout(jsonb_set(v_checkout, '{price_currency}', '"cny"'))
       OR public.tg_valid_purchase_crypto_checkout(v_checkout - 'price_currency') THEN
        RAISE EXCEPTION 'TG native currency/exact amount validation mismatch';
    END IF;
    -- Existing USD records can have 18-decimal market amounts. Do not rewrite
    -- or force their amount to match the USDT merchant prices of new orders.
    v_checkout := jsonb_set(jsonb_set(v_checkout, '{price_currency}', '"usd"'), '{pay_amount}', '"11.066812345678901234"');
    IF NOT public.tg_valid_purchase_crypto_checkout(v_checkout) THEN
        RAISE EXCEPTION 'Legacy USD checkout compatibility lost';
    END IF;
    v_source := pg_get_functiondef('public.fn_tg_confirm_purchase_payment(text,text,text,text,text,bigint,text,jsonb)'::regprocedure);
    IF position('IS DISTINCT FROM v_order.crypto_checkout->>''price_currency''' IN v_source) = 0
       OR position('signed_notify_and_query' IN v_source) = 0
       OR position('v_order.total_minor IS DISTINCT FROM p_amount_minor' IN v_source) = 0
       OR position('payment_received_after_cancellation' IN v_source) = 0
       OR position('payment_received_after_expiry' IN v_source) = 0
       OR position('INSERT INTO public.tg_redemption_orders' IN v_source) < position('v_order.cancelled_at IS NOT NULL' IN v_source) THEN
        RAISE EXCEPTION 'TG native settlement binding or late payment guards missing';
    END IF;
    v_source := pg_get_functiondef('public.fn_tg_save_purchase_crypto_checkout(uuid,uuid,text,jsonb)'::regprocedure);
    IF position('5 minutes' IN v_source) > 0 OR position('> v_order.payment_expires_at' IN v_source) = 0 THEN
        RAISE EXCEPTION 'TG provider/order expiry contract mismatch';
    END IF;
    v_source := pg_get_functiondef('public.tg_guard_purchase_crypto_identity()'::regprocedure);
    IF position('TG crypto quote is immutable' IN v_source) = 0 THEN
        RAISE EXCEPTION 'TG immutable checkout guard missing';
    END IF;
    FOREACH v_name IN ARRAY ARRAY['public.fn_tg_usdt_pricing_contract()',
        'public.tg_valid_purchase_crypto_checkout(jsonb)',
        'public.fn_tg_confirm_purchase_payment(text,text,text,text,text,bigint,text,jsonb)'] LOOP
        IF has_function_privilege('anon', v_name, 'EXECUTE')
           OR has_function_privilege('authenticated', v_name, 'EXECUTE')
           OR NOT has_function_privilege('service_role', v_name, 'EXECUTE') THEN
            RAISE EXCEPTION 'TG service-only permission mismatch: %', v_name;
        END IF;
    END LOOP;
END;
$$;
COMMIT;
