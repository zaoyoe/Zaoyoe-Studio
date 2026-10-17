BEGIN;
-- Apply after cancellation_expiry, usdt_native_pricing and payment_usdt_market_fx.
-- The historical usdt_bep20 channel remains the USDT payment-method identifier.
-- A separate immutable quote binding identifies the actual incoming network.
-- No switches, existing orders, secrets or balances are changed.
CREATE TABLE IF NOT EXISTS public.tg_purchase_network_quotes (
    quote_id UUID PRIMARY KEY REFERENCES public.tg_purchase_quotes(id),
    pay_currency TEXT NOT NULL CHECK (pay_currency IN ('usdtbsc','usdtton','usdtmatic','usdttrc20')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_tg_purchase_network_immutable ON public.tg_purchase_network_quotes;
CREATE TRIGGER trg_tg_purchase_network_immutable BEFORE UPDATE OR DELETE ON public.tg_purchase_network_quotes
FOR EACH ROW EXECUTE FUNCTION public.payment_guard_fx_snapshot();
ALTER TABLE public.tg_purchase_network_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tg_purchase_network_quotes FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_tg_purchase_network_quote(p_quote_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$ SELECT jsonb_build_object('pay_currency', pay_currency) FROM public.tg_purchase_network_quotes WHERE quote_id = p_quote_id; $$;

CREATE OR REPLACE FUNCTION public.fn_tg_bind_purchase_network_quote(p_quote_id UUID, p_pay_currency TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_quote public.tg_purchase_quotes%ROWTYPE; v_currency TEXT;
BEGIN
    SELECT * INTO v_quote FROM public.tg_purchase_quotes WHERE id = p_quote_id FOR UPDATE;
    IF v_quote.id IS NULL OR v_quote.expires_at <= now() OR v_quote.payment_channel IS DISTINCT FROM 'usdt_bep20'
       OR p_pay_currency IS NULL OR p_pay_currency NOT IN ('usdtbsc','usdtton','usdtmatic','usdttrc20') THEN
        RAISE EXCEPTION 'Invalid USDT network quote' USING ERRCODE = '23514';
    END IF;
    SELECT pay_currency INTO v_currency FROM public.tg_purchase_network_quotes WHERE quote_id = p_quote_id;
    IF v_currency IS NOT NULL AND v_currency IS DISTINCT FROM p_pay_currency THEN
        RAISE EXCEPTION 'USDT network quote immutable' USING ERRCODE = '23514';
    END IF;
    IF v_currency IS NULL THEN
        IF EXISTS(SELECT 1 FROM public.tg_purchase_orders WHERE quote_id = p_quote_id) THEN
            RAISE EXCEPTION 'Cannot bind network after order creation' USING ERRCODE = '23514';
        END IF;
        INSERT INTO public.tg_purchase_network_quotes(quote_id, pay_currency) VALUES(p_quote_id, p_pay_currency);
    END IF;
    RETURN public.fn_tg_purchase_network_quote(p_quote_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_valid_purchase_crypto_checkout(p_checkout JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_checkout IS NULL OR jsonb_typeof(p_checkout) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF NOT (p_checkout ?& ARRAY['payment_id', 'network', 'pay_currency', 'pay_amount', 'pay_address', 'quote_expires_at', 'price_currency', 'price_amount_minor'])
       OR (SELECT count(*) FROM jsonb_object_keys(p_checkout)) NOT IN (8, 9)
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_checkout) k WHERE k NOT IN ('payment_id','network','pay_currency','pay_amount','pay_address','quote_expires_at','price_currency','price_amount_minor','payin_extra_id'))
       OR (p_checkout ? 'payin_extra_id' AND (jsonb_typeof(p_checkout->'payin_extra_id') IS DISTINCT FROM 'string' OR coalesce(p_checkout->>'payin_extra_id', '') !~ '^[!-~]{1,128}$'))
       OR jsonb_typeof(p_checkout->'payment_id') IS DISTINCT FROM 'string'
       OR coalesce(p_checkout->>'payment_id', '') !~ '^[0-9]{1,32}$'
       OR p_checkout->>'network' IS DISTINCT FROM (CASE p_checkout->>'pay_currency' WHEN 'usdtbsc' THEN 'BSC (BEP20)' WHEN 'usdtton' THEN 'TON' WHEN 'usdtmatic' THEN 'Polygon' WHEN 'usdttrc20' THEN 'TRON (TRC20)' END)
       OR coalesce(p_checkout->>'pay_currency', '') NOT IN ('usdtbsc', 'usdtton', 'usdtmatic', 'usdttrc20')
       OR (p_checkout->>'price_currency' IS DISTINCT FROM 'usd' AND p_checkout->>'price_currency' IS DISTINCT FROM p_checkout->>'pay_currency')
       OR jsonb_typeof(p_checkout->'pay_amount') IS DISTINCT FROM 'string'
       OR coalesce(p_checkout->>'pay_amount', '') !~ '^(0|[1-9][0-9]{0,12})([.][0-9]{1,18})?$'
       OR jsonb_typeof(p_checkout->'price_amount_minor') IS DISTINCT FROM 'number'
       OR coalesce(p_checkout->>'price_amount_minor', '') !~ '^[1-9][0-9]{0,9}$'
       OR NOT coalesce(CASE p_checkout->>'pay_currency' WHEN 'usdtbsc' THEN p_checkout->>'pay_address' ~ '^0x[0-9a-fA-F]{40}$' WHEN 'usdtmatic' THEN p_checkout->>'pay_address' ~ '^0x[0-9a-fA-F]{40}$' WHEN 'usdttrc20' THEN p_checkout->>'pay_address' ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' WHEN 'usdtton' THEN p_checkout->>'pay_address' ~ '^([EUek]Q[A-Za-z0-9_-]{46}|-?[0-9]+:[0-9a-fA-F]{64})$' END, false)
       OR coalesce(p_checkout->>'quote_expires_at', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,3})?Z$' THEN RETURN false; END IF;
    RETURN (p_checkout->>'pay_amount')::NUMERIC > 0
        AND (p_checkout->>'price_currency' = 'usd' OR (p_checkout->>'pay_amount')::NUMERIC * 100 = (p_checkout->>'price_amount_minor')::BIGINT)
        AND (p_checkout->>'price_amount_minor')::BIGINT BETWEEN 1 AND 1000000000
        AND (p_checkout->>'quote_expires_at')::TIMESTAMPTZ IS NOT NULL;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
    RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_save_purchase_crypto_checkout(
    p_purchase_id UUID, p_lease_token UUID, p_provider_trade_no TEXT, p_crypto_checkout JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_order public.tg_purchase_orders%ROWTYPE;
BEGIN
    IF p_purchase_id IS NULL OR p_lease_token IS NULL OR coalesce(p_provider_trade_no, '') !~ '^[0-9]{1,32}$'
       OR NOT public.tg_valid_purchase_crypto_checkout(p_crypto_checkout)
       OR p_crypto_checkout->>'payment_id' IS DISTINCT FROM p_provider_trade_no THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_checkout');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('tg-payment-trade:' || p_provider_trade_no, 0));
    SELECT * INTO v_order FROM public.tg_purchase_orders WHERE id = p_purchase_id FOR UPDATE;
    IF v_order.id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'not_found'); END IF;
    IF p_crypto_checkout->>'pay_currency' IS DISTINCT FROM coalesce((SELECT pay_currency FROM public.tg_purchase_network_quotes WHERE quote_id = v_order.quote_id), 'usdtbsc') THEN
        RETURN jsonb_build_object('success', false, 'code', 'payment_network_mismatch');
    END IF;
    IF v_order.payment_provider <> 'nowpayments' OR v_order.payment_channel <> 'usdt_bep20'
       OR v_order.crypto_checkout IS NOT NULL
       OR (p_crypto_checkout->>'quote_expires_at')::TIMESTAMPTZ <= now()
       OR (p_crypto_checkout->>'quote_expires_at')::TIMESTAMPTZ > v_order.payment_expires_at THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_checkout');
    END IF;
    IF v_order.checkout_lease_token IS DISTINCT FROM p_lease_token OR v_order.checkout_lease_expires_at <= now()
       OR v_order.payment_status <> 'checkout_creating' THEN
        RETURN jsonb_build_object('success', false, 'code', 'lease_lost');
    END IF;
    IF EXISTS (SELECT 1 FROM public.tg_purchase_orders WHERE payment_provider = v_order.payment_provider
        AND payment_merchant_id = v_order.payment_merchant_id AND provider_trade_no = p_provider_trade_no AND id <> v_order.id) THEN
        UPDATE public.tg_purchase_orders SET payment_status = 'manual_review', last_error_code = 'payment_trade_conflict',
            checkout_lease_token = NULL, checkout_lease_expires_at = NULL, updated_at = now() WHERE id = v_order.id;
        RETURN jsonb_build_object('success', false, 'code', 'payment_trade_conflict');
    END IF;
    UPDATE public.tg_purchase_orders SET provider_trade_no = p_provider_trade_no, crypto_checkout = p_crypto_checkout,
        payment_status = 'awaiting_payment', checkout_lease_token = NULL, checkout_lease_expires_at = NULL, updated_at = now()
    WHERE id = v_order.id;
    RETURN jsonb_build_object('success', true, 'order', public.tg_purchase_order_json(v_order.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_confirm_purchase_payment(
    p_order_no TEXT, p_provider TEXT, p_merchant_id TEXT, p_provider_trade_no TEXT,
    p_payment_channel TEXT, p_amount_minor BIGINT, p_currency TEXT, p_verified_payload JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.tg_purchase_orders%ROWTYPE;
    v_fulfillment public.tg_redemption_orders%ROWTYPE;
BEGIN
    -- This RPC is service-only. Signature verification happens before the call;
    -- it never accepts a browser redirect as proof of payment.
    IF coalesce(p_order_no, '') !~ '^TGP-[A-Z0-9]{20}$'
       OR NOT coalesce((p_provider = 'zpay' AND p_payment_channel IN ('alipay', 'wxpay') AND p_merchant_id ~ '^[0-9]{1,32}$')
          OR (p_provider = 'nowpayments' AND p_payment_channel = 'usdt_bep20' AND p_merchant_id ~ '^nowpayments:[0-9a-f]{64}$'), false)
       OR coalesce(p_provider_trade_no, '') !~ '^[A-Za-z0-9_-]{1,200}$'
       OR p_amount_minor IS NULL OR p_amount_minor < 1 OR p_currency IS DISTINCT FROM 'CNY'
       OR jsonb_typeof(p_verified_payload) IS DISTINCT FROM 'object'
       OR (p_provider = 'zpay' AND p_verified_payload->>'verified_by' IS DISTINCT FROM 'signed_notify')
       OR (p_provider = 'nowpayments' AND p_verified_payload->>'verified_by' IS DISTINCT FROM 'signed_notify_and_query')
       OR p_verified_payload->>'event_status' IS DISTINCT FROM 'paid' THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_payment');
    END IF;
    -- Same lock order as saving the checkout response: trade identity, purchase,
    -- then fulfillment. A notify can safely arrive before save_checkout.
    PERFORM pg_advisory_xact_lock(hashtextextended('tg-payment-trade:' || p_provider_trade_no, 0));
    SELECT * INTO v_order FROM public.tg_purchase_orders WHERE order_no = p_order_no FOR UPDATE;
    IF v_order.id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'not_found'); END IF;
    IF v_order.payment_provider IS DISTINCT FROM p_provider OR v_order.payment_merchant_id IS DISTINCT FROM p_merchant_id
       OR v_order.payment_channel IS DISTINCT FROM p_payment_channel OR v_order.total_minor IS DISTINCT FROM p_amount_minor
       OR v_order.currency IS DISTINCT FROM p_currency OR v_order.checkout_started_at IS NULL
       OR (v_order.provider_trade_no IS NOT NULL AND v_order.provider_trade_no IS DISTINCT FROM p_provider_trade_no)
       OR EXISTS (SELECT 1 FROM public.tg_purchase_orders other WHERE other.id <> v_order.id
            AND other.payment_provider = p_provider AND other.payment_merchant_id = p_merchant_id
            AND other.provider_trade_no = p_provider_trade_no) THEN
        INSERT INTO public.tg_audit_events(event_type, target_type, target_id, metadata)
        VALUES ('purchase_payment_rejected', 'purchase_order', v_order.id, jsonb_build_object('reason', 'payment_binding_mismatch'));
        RETURN jsonb_build_object('success', false, 'code', 'payment_binding_mismatch');
    END IF;
    -- A signed IPN and independent provider GET must agree with the immutable
    -- saved USD/USDT quote. The browser and fiat-only callback cannot authorize USDT.
    IF p_provider = 'nowpayments' THEN
        IF NOT public.tg_valid_purchase_crypto_checkout(v_order.crypto_checkout)
           OR v_order.provider_trade_no IS DISTINCT FROM p_provider_trade_no
           OR v_order.crypto_checkout->>'payment_id' IS DISTINCT FROM p_provider_trade_no
           OR p_verified_payload->>'price_currency' IS DISTINCT FROM v_order.crypto_checkout->>'price_currency'
           OR p_verified_payload->>'price_amount_minor' IS DISTINCT FROM v_order.crypto_checkout->>'price_amount_minor'
           OR p_verified_payload->>'pay_currency' IS DISTINCT FROM v_order.crypto_checkout->>'pay_currency'
           OR p_verified_payload->>'actually_paid_currency' IS DISTINCT FROM v_order.crypto_checkout->>'pay_currency'
           OR coalesce(p_verified_payload->>'payin_extra_id', '') IS DISTINCT FROM coalesce(v_order.crypto_checkout->>'payin_extra_id', '')
           OR p_verified_payload->>'pay_address' IS DISTINCT FROM v_order.crypto_checkout->>'pay_address'
           OR p_verified_payload->>'pay_amount' IS DISTINCT FROM v_order.crypto_checkout->>'pay_amount'
           OR coalesce(p_verified_payload->>'actually_paid', '') !~ '^(0|[1-9][0-9]{0,12})([.][0-9]{1,18})?$' THEN
            RETURN jsonb_build_object('success', false, 'code', 'payment_binding_mismatch');
        END IF;
        IF (p_verified_payload->>'actually_paid')::NUMERIC < (v_order.crypto_checkout->>'pay_amount')::NUMERIC THEN
            RETURN jsonb_build_object('success', false, 'code', 'payment_binding_mismatch');
        END IF;
    END IF;
    IF v_order.payment_status = 'paid' OR v_order.paid_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'existing', true, 'order', public.tg_purchase_order_json(v_order.id));
    END IF;
    -- Cancellation and settlement serialize on the purchase row. A payment
    -- received after cancellation is retained for review, never auto-fulfilled.
    IF v_order.cancelled_at IS NOT NULL THEN
        UPDATE public.tg_purchase_orders SET payment_status = 'manual_review', provider_trade_no = p_provider_trade_no,
            paid_at = now(), verified_payment = p_verified_payload,
            last_error_code = 'payment_received_after_cancellation', checkout_lease_token = NULL, checkout_lease_expires_at = NULL,
            updated_at = now() WHERE id = v_order.id;
        INSERT INTO public.tg_audit_events(event_type, target_type, target_id, metadata)
        VALUES ('purchase_payment_manual_review', 'purchase_order', v_order.id,
            jsonb_build_object('reason', 'payment_received_after_cancellation'));
        RETURN jsonb_build_object('success', true, 'existing', false, 'order', public.tg_purchase_order_json(v_order.id));
    END IF;
    IF v_order.payment_expires_at <= now() OR (p_provider = 'nowpayments'
        AND (v_order.crypto_checkout->>'quote_expires_at')::TIMESTAMPTZ <= now()) THEN
        -- A real payment after the accepted window is retained for review,
        -- never thrown away or auto-fulfilled under an expired quote.
        UPDATE public.tg_purchase_orders SET payment_status = 'manual_review', provider_trade_no = p_provider_trade_no,
            paid_at = now(), verified_payment = p_verified_payload,
            last_error_code = 'payment_received_after_expiry', checkout_lease_token = NULL, checkout_lease_expires_at = NULL,
            updated_at = now() WHERE id = v_order.id;
        INSERT INTO public.tg_audit_events(event_type, target_type, target_id, metadata)
        VALUES ('purchase_payment_manual_review', 'purchase_order', v_order.id, jsonb_build_object('reason', 'payment_received_after_expiry'));
        RETURN jsonb_build_object('success', true, 'existing', false, 'order', public.tg_purchase_order_json(v_order.id));
    END IF;
    UPDATE public.tg_purchase_orders SET payment_status = 'paid', provider_trade_no = p_provider_trade_no,
        paid_at = now(), verified_payment = p_verified_payload,
        last_error_code = NULL, checkout_lease_token = NULL, checkout_lease_expires_at = NULL, updated_at = now()
    WHERE id = v_order.id RETURNING * INTO v_order;
    INSERT INTO public.tg_redemption_orders(order_no, order_source, purchase_id, code_id, product_family, term_months,
        stars_quantity, telegram_username, status_token_hash, idempotency_key_hash, provider_idempotency_key)
    VALUES ('TG-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 20)), 'purchase', v_order.id, NULL,
        v_order.product_family, v_order.term_months, v_order.stars_quantity, v_order.telegram_username,
        v_order.status_token_hash, encode(sha256(convert_to('tg-purchase:' || v_order.id::TEXT, 'UTF8')), 'hex'),
        'tg-purchase-' || replace(v_order.id::TEXT, '-', ''))
    RETURNING * INTO v_fulfillment;
    INSERT INTO public.tg_audit_events(event_type, target_type, target_id, metadata)
    VALUES ('purchase_payment_confirmed', 'purchase_order', v_order.id,
        jsonb_build_object('fulfillment_id', v_fulfillment.id, 'total_minor', v_order.total_minor, 'currency', v_order.currency));
    RETURN jsonb_build_object('success', true, 'existing', false, 'order', public.tg_purchase_order_json(v_order.id));
END;
$$;

REVOKE ALL ON FUNCTION public.fn_tg_purchase_network_quote(UUID), public.fn_tg_bind_purchase_network_quote(UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_purchase_network_quote(UUID), public.fn_tg_bind_purchase_network_quote(UUID,TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
