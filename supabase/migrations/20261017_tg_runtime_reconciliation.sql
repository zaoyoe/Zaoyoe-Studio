-- Operator-applied additive reconciliation. Run after ALL restored TG migrations,
-- especially network selection, ZPay reconciliation, operations closure and review resolution.
-- Earlier executed migrations are retained unchanged as historical evidence.
-- This file installs functions only: no order replay, switch enablement, or refund.
BEGIN;
DO $$
BEGIN
    IF to_regprocedure('public.fn_tg_purchase_resolution_ready()') IS NULL
       OR to_regprocedure('public.fn_tg_bind_purchase_network_quote(uuid,text)') IS NULL
       OR to_regprocedure('public.fn_tg_review_order(uuid,text,timestamp with time zone,uuid,text,jsonb)') IS NULL THEN
        RAISE EXCEPTION 'Apply TG network, payment, operations and resolution migrations first';
    END IF;
    IF NOT public.fn_tg_purchase_resolution_ready() THEN
        RAISE EXCEPTION 'TG review resolution prerequisite is not ready';
    END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.tg_purchase_order_json(p_order_id UUID)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT jsonb_build_object('id', p.id, 'order_no', p.order_no, 'quote_id', p.quote_id,
        'product_family', p.product_family, 'term_months', p.term_months, 'stars_quantity', p.stars_quantity,
        'telegram_username', p.telegram_username, 'currency', p.currency, 'total_minor', p.total_minor,
        'subtotal_minor', p.subtotal_minor, 'payment_fee_minor', p.payment_fee_minor,
        'payment_fee_rate_bps', p.payment_fee_rate_bps, 'price_version', p.price_version, 'payment_channel', p.payment_channel,
        'payment_provider', p.payment_provider, 'payment_merchant_id', p.payment_merchant_id,
        'payment_status', p.payment_status, 'checkout_url', p.checkout_url, 'crypto_checkout', p.crypto_checkout, 'provider_trade_no', p.provider_trade_no,
        'payment_expires_at', p.payment_expires_at, 'expires_at', p.payment_expires_at,
        'paid_at', p.paid_at, 'created_at', p.created_at, 'updated_at', p.updated_at, 'closed_at', p.closed_at,
        'fulfillment_status', CASE WHEN p.closed_at IS NOT NULL THEN 'closed' ELSE coalesce(f.status, 'not_started') END,
        'fulfillment_order_no', f.order_no,
        'can_close', p.closed_at IS NULL AND p.payment_status IN ('awaiting_payment', 'expired')
            AND p.paid_at IS NULL AND p.checkout_lease_token IS NULL AND p.last_error_code IS NULL AND f.id IS NULL)
    FROM public.tg_purchase_orders p LEFT JOIN public.tg_redemption_orders f ON f.purchase_id = p.id
    WHERE p.id = p_order_id;
$$;

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
    IF v_order.closed_at IS NOT NULL OR v_order.cancelled_at IS NOT NULL OR v_order.payment_provider <> 'nowpayments' OR v_order.payment_channel <> 'usdt_bep20'
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
       OR (p_provider = 'zpay' AND coalesce(p_verified_payload->>'verified_by', '') NOT IN ('signed_notify', 'authenticated_query'))
       OR (p_provider = 'nowpayments' AND p_verified_payload->>'verified_by' IS DISTINCT FROM 'signed_notify_and_query')
       OR p_verified_payload->>'event_status' IS DISTINCT FROM 'paid' THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_payment');
    END IF;
    -- Provider-query proof is produced only by an authenticated server-side
    -- merchant API request. A browser return URL is never settlement evidence.
    IF p_provider = 'zpay' AND p_verified_payload->>'verified_by' = 'authenticated_query' AND (
        p_verified_payload->>'provider_order_no' IS DISTINCT FROM p_order_no
        OR p_verified_payload->>'merchant_id' IS DISTINCT FROM p_merchant_id
        OR p_verified_payload->>'provider_trade_no' IS DISTINCT FROM p_provider_trade_no
        OR p_verified_payload->>'payment_channel' IS DISTINCT FROM p_payment_channel
        OR p_verified_payload->>'amount_minor' IS DISTINCT FROM p_amount_minor::TEXT
        OR p_verified_payload->>'currency' IS DISTINCT FROM p_currency
    ) THEN
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
       OR (v_order.provider_trade_no IS NOT NULL AND v_order.provider_trade_no IS DISTINCT FROM p_provider_trade_no
           -- Missing proof fields must deny alias replacement (SQL NULL is not false).
           AND NOT coalesce((p_provider = 'zpay' AND p_verified_payload->>'verified_by' = 'authenticated_query'
               AND v_order.provider_trade_no = v_order.order_no
               AND p_verified_payload->>'checkout_trade_no' = v_order.provider_trade_no
               AND v_order.paid_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM public.tg_redemption_orders f WHERE f.purchase_id = v_order.id)), false))
       OR EXISTS (SELECT 1 FROM public.tg_purchase_orders other WHERE other.id <> v_order.id
            AND other.payment_provider = p_provider AND other.payment_merchant_id = p_merchant_id
            AND other.provider_trade_no = p_provider_trade_no) THEN
        INSERT INTO public.tg_audit_events(event_type, target_type, target_id, metadata)
        VALUES ('purchase_payment_rejected', 'purchase_order', v_order.id, jsonb_build_object('reason', 'payment_binding_mismatch'));
        RETURN jsonb_build_object('success', false, 'code', 'payment_binding_mismatch');
    END IF;
    IF v_order.provider_trade_no = v_order.order_no AND v_order.provider_trade_no IS DISTINCT FROM p_provider_trade_no THEN
        INSERT INTO public.tg_audit_events(event_type, target_type, target_id, metadata)
        VALUES ('purchase_payment_trade_reconciled', 'purchase_order', v_order.id,
            jsonb_build_object('verified_by', 'authenticated_query', 'previous_trade_no', v_order.provider_trade_no,
                'provider_trade_no', p_provider_trade_no));
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
    IF v_order.cancelled_at IS NOT NULL OR v_order.closed_at IS NOT NULL OR v_order.payment_status = 'cancelled' THEN
        UPDATE public.tg_purchase_orders SET payment_status = 'manual_review', provider_trade_no = p_provider_trade_no,
            paid_at = now(), verified_payment = p_verified_payload,
            last_error_code = CASE WHEN v_order.closed_at IS NOT NULL THEN 'payment_received_after_close' ELSE 'payment_received_after_cancellation' END, checkout_lease_token = NULL, checkout_lease_expires_at = NULL,
            updated_at = now() WHERE id = v_order.id;
        INSERT INTO public.tg_audit_events(event_type, target_type, target_id, metadata)
        VALUES ('purchase_payment_manual_review', 'purchase_order', v_order.id,
            jsonb_build_object('reason', CASE WHEN v_order.closed_at IS NOT NULL THEN 'payment_received_after_close' ELSE 'payment_received_after_cancellation' END));
        RETURN jsonb_build_object('success', true, 'existing', false, 'order', public.tg_purchase_order_json(v_order.id));
    END IF;
    IF v_order.payment_status IN ('manual_review', 'expired') OR v_order.payment_expires_at <= now() OR (p_provider = 'nowpayments'
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

CREATE OR REPLACE FUNCTION public.fn_tg_close_purchase(
    p_order_no TEXT, p_status_token_hash CHAR(64), p_actor_id UUID,
    p_expected_updated_at TIMESTAMPTZ, p_note TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_order public.tg_purchase_orders%ROWTYPE;
BEGIN
    IF coalesce(p_order_no, '') !~ '^TGP-[A-Z0-9]{20}$'
       OR (p_actor_id IS NULL AND coalesce(p_status_token_hash, '') !~ '^[0-9a-f]{64}$')
       OR (p_actor_id IS NOT NULL AND (p_status_token_hash IS NOT NULL OR p_expected_updated_at IS NULL))
       OR coalesce(length(trim(p_note)), 0) NOT BETWEEN 1 AND 500 THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_request');
    END IF;
    SELECT * INTO v_order FROM public.tg_purchase_orders WHERE order_no = p_order_no FOR UPDATE;
    IF v_order.id IS NULL OR (p_actor_id IS NULL AND v_order.status_token_hash IS DISTINCT FROM p_status_token_hash) THEN
        RETURN jsonb_build_object('success', false, 'code', 'not_found');
    END IF;
    IF v_order.payment_status = 'cancelled' THEN
        RETURN jsonb_build_object('success', true, 'existing', true, 'order', public.tg_purchase_order_json(v_order.id));
    END IF;
    IF p_actor_id IS NOT NULL AND v_order.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RETURN jsonb_build_object('success', false, 'code', 'version_conflict');
    END IF;
    -- Lock purchase before fulfillment, matching callback/worker. An unresolved
    -- checkout is never closed; its provider response may still be in flight.
    IF v_order.closed_at IS NOT NULL OR v_order.payment_status NOT IN ('awaiting_payment', 'expired') OR v_order.paid_at IS NOT NULL
       OR v_order.checkout_lease_token IS NOT NULL OR v_order.last_error_code IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.tg_redemption_orders WHERE purchase_id = v_order.id) THEN
        RETURN jsonb_build_object('success', false, 'code', 'close_not_allowed');
    END IF;
    UPDATE public.tg_purchase_orders SET payment_status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()), checkout_url = NULL, updated_at = now()
    WHERE id = v_order.id;
    INSERT INTO public.tg_audit_events(actor_user_id, event_type, target_type, target_id, metadata)
    VALUES (p_actor_id, 'purchase_closed', 'purchase_order', v_order.id,
        jsonb_build_object('note', trim(p_note), 'actor', CASE WHEN p_actor_id IS NULL THEN 'customer' ELSE 'admin' END));
    RETURN jsonb_build_object('success', true, 'order', public.tg_purchase_order_json(v_order.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_review_purchase(
    p_order_no TEXT, p_action TEXT, p_expected_updated_at TIMESTAMPTZ, p_actor_id UUID, p_note TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_order public.tg_purchase_orders%ROWTYPE;
BEGIN
    -- Approval must use fn_tg_approve_purchase_fulfillment via the review service:
    -- it rechecks the provider and requires no-refund / no-delivery confirmations.
    IF p_action = 'approve_payment' THEN
        RETURN jsonb_build_object('success', false, 'code', 'payment_recheck_required');
    END IF;
    IF p_actor_id IS NULL OR p_expected_updated_at IS NULL OR p_action IS DISTINCT FROM 'note'
       OR coalesce(length(trim(p_note)), 0) NOT BETWEEN 1 AND 500 THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_request');
    END IF;
    SELECT * INTO v_order FROM public.tg_purchase_orders WHERE order_no = p_order_no FOR UPDATE;
    IF v_order.id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'not_found'); END IF;
    IF v_order.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RETURN jsonb_build_object('success', false, 'code', 'version_conflict');
    END IF;
    UPDATE public.tg_purchase_orders SET updated_at = now() WHERE id = v_order.id;
    INSERT INTO public.tg_audit_events(actor_user_id, event_type, target_type, target_id, metadata)
    VALUES (p_actor_id, 'purchase_review', 'purchase_order', v_order.id,
        jsonb_build_object('action', p_action, 'note', trim(p_note), 'previous_status', v_order.payment_status));
    RETURN jsonb_build_object('success', true, 'order', public.tg_purchase_order_json(v_order.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_review_order(
    p_order_id UUID, p_action TEXT, p_expected_updated_at TIMESTAMPTZ,
    p_actor_id UUID, p_note TEXT, p_snapshot JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_order public.tg_redemption_orders%ROWTYPE;
    v_source public.tg_redemption_orders%ROWTYPE;
    v_code public.tg_redemption_codes%ROWTYPE;
    v_purchase public.tg_purchase_orders%ROWTYPE;
    v_lease UUID := gen_random_uuid(); v_state TEXT; v_result JSONB; v_bound BOOLEAN;
BEGIN
    IF p_order_id IS NULL OR p_actor_id IS NULL OR p_expected_updated_at IS NULL
       OR coalesce(p_action, '') NOT IN ('reconcile', 'resume_unsubmitted', 'close', 'note')
       OR coalesce(length(trim(p_note)), 0) NOT BETWEEN 1 AND 500
       OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_request');
    END IF;
    SELECT * INTO v_source FROM public.tg_redemption_orders WHERE id = p_order_id;
    IF v_source.id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'not_found'); END IF;
    IF v_source.order_source = 'purchase' THEN
        SELECT * INTO v_purchase FROM public.tg_purchase_orders WHERE id = v_source.purchase_id FOR UPDATE;
    ELSE
        SELECT * INTO v_code FROM public.tg_redemption_codes WHERE id = v_source.code_id FOR UPDATE;
    END IF;
    SELECT * INTO v_order FROM public.tg_redemption_orders WHERE id = p_order_id FOR UPDATE;
    IF v_order.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RETURN jsonb_build_object('success', false, 'code', 'version_conflict');
    END IF;
    IF p_action <> 'note' THEN
        IF (p_action = 'close' AND (v_order.order_source <> 'redemption' OR v_order.status NOT IN ('pending', 'manual_review')))
           OR (p_action <> 'close' AND v_order.status <> 'manual_review')
           OR (v_order.lease_token IS NOT NULL AND v_order.lease_expires_at > now()) THEN
            RETURN jsonb_build_object('success', false, 'code', 'review_not_allowed');
        END IF;
        IF (v_order.order_source = 'purchase' AND (v_purchase.closed_at IS NOT NULL OR v_purchase.payment_status IS DISTINCT FROM 'paid' OR v_purchase.paid_at IS NULL))
           OR (v_order.order_source = 'redemption' AND (v_code.id IS NULL OR v_code.status NOT IN ('reserved', 'fulfilling'))) THEN
            RETURN jsonb_build_object('success', false, 'code', 'source_unconfirmed');
        END IF;
    END IF;
    IF p_action IN ('resume_unsubmitted', 'close') THEN
        -- Never reset submitted_at, provider identity or the code reservation.
        IF v_order.submitted_at IS NOT NULL OR v_order.provider_order_id IS NOT NULL
           OR v_order.provider_payment_currency IS NOT NULL OR v_order.attempt_count <> 0
           OR EXISTS (SELECT 1 FROM public.tg_fulfillment_attempts WHERE order_id = v_order.id) THEN
            RETURN jsonb_build_object('success', false, 'code', 'submission_unknown');
        END IF;
        UPDATE public.tg_redemption_orders SET status = CASE WHEN p_action = 'close' THEN 'cancelled' ELSE 'pending' END,
            cancelled_at = CASE WHEN p_action = 'close' THEN now() ELSE cancelled_at END, next_attempt_at = now(),
            lease_token = NULL, lease_expires_at = NULL, last_error_code = NULL, last_error_message = NULL,
            updated_at = now() WHERE id = v_order.id;
        IF p_action = 'close' THEN
            UPDATE public.tg_redemption_codes SET status = 'available', reserved_at = NULL,
                reservation_expires_at = NULL, telegram_username = NULL, updated_at = now() WHERE id = v_order.code_id;
        ELSIF v_order.order_source = 'redemption' THEN
            UPDATE public.tg_redemption_codes SET reservation_expires_at = NULL, updated_at = now() WHERE id = v_order.code_id;
        END IF;
    ELSIF p_action = 'reconcile' THEN
        -- Validate failures and pending states as rigorously as success. The
        -- worker finalizer performs entitlement and source checks again.
        v_bound := v_order.provider_order_id IS NOT NULL AND v_order.submitted_at IS NOT NULL
            AND p_snapshot->>'provider_order_id' = v_order.provider_order_id
            AND p_snapshot->>'verified_by' = 'order_get' AND p_snapshot->>'method' = 'api'
            AND p_snapshot->>'telegram_username' = v_order.telegram_username
            AND p_snapshot->>'product_family' = v_order.product_family
            AND p_snapshot->'term_months' = coalesce(to_jsonb(v_order.term_months), 'null'::JSONB)
            AND p_snapshot->'stars_quantity' = coalesce(to_jsonb(v_order.stars_quantity), 'null'::JSONB)
            AND p_snapshot->>'product_type' = CASE WHEN v_order.product_family = 'telegram_stars'
                THEN 'stars' ELSE 'premium_' || v_order.term_months::TEXT || '_month' END
            AND p_snapshot->>'currency' = CASE v_order.provider_payment_currency WHEN 'usdt' THEN 'usd' WHEN 'gram' THEN 'gram' END
            AND coalesce(p_snapshot->>'amount', '') ~ '^(0|[1-9][0-9]*)([.][0-9]+)?$'
            AND coalesce(p_snapshot->'idempotency_key_matches', 'null'::JSONB) <> 'false'::JSONB
            AND p_snapshot->>'provider_status' IN ('created', 'processing', 'completed', 'failed', 'canceled');
        IF NOT coalesce(v_bound, false) THEN
            RETURN jsonb_build_object('success', false, 'code', 'provider_unverified');
        END IF;
        v_state := CASE p_snapshot->>'provider_status' WHEN 'completed' THEN 'succeeded'
            WHEN 'failed' THEN 'failed' WHEN 'canceled' THEN 'failed' ELSE 'retry_waiting' END;
        UPDATE public.tg_redemption_orders SET status = 'processing', lease_token = v_lease,
            lease_expires_at = now() + interval '120 seconds', updated_at = now() WHERE id = v_order.id;
        v_result := public.fn_tg_finish_order(v_order.id, v_lease, v_state, v_order.provider_order_id, p_snapshot,
            CASE WHEN v_state = 'failed' THEN 'provider_confirmed_failure' END,
            CASE WHEN v_state = 'failed' THEN '上游已确认失败；客户退款需另行核对' END, now() + interval '30 seconds');
        IF v_result->>'success' IS DISTINCT FROM 'true' THEN
            RAISE EXCEPTION 'TG review finalization rejected' USING ERRCODE = '23514';
        END IF;
    ELSE
        UPDATE public.tg_redemption_orders SET updated_at = now() WHERE id = v_order.id;
    END IF;
    INSERT INTO public.tg_audit_events(actor_user_id, event_type, target_type, target_id, metadata)
    VALUES (p_actor_id, 'order_review', 'redemption_order', v_order.id,
        jsonb_build_object('action', p_action, 'note', trim(p_note), 'previous_status', v_order.status,
            'result_status', coalesce(v_result->>'status', CASE WHEN p_action = 'resume_unsubmitted' THEN 'pending' WHEN p_action = 'close' THEN 'cancelled' ELSE v_order.status END)));
    RETURN jsonb_build_object('success', true, 'status', coalesce(v_result->>'status',
        CASE WHEN p_action = 'resume_unsubmitted' THEN 'pending' WHEN p_action = 'close' THEN 'cancelled' ELSE v_order.status END));
END;
$$;
REVOKE ALL ON FUNCTION public.tg_purchase_order_json(UUID),
    public.fn_tg_purchase_network_quote(UUID),
    public.fn_tg_bind_purchase_network_quote(UUID,TEXT),
    public.tg_valid_purchase_crypto_checkout(JSONB),
    public.fn_tg_save_purchase_crypto_checkout(UUID,UUID,TEXT,JSONB),
    public.fn_tg_confirm_purchase_payment(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,JSONB),
    public.fn_tg_close_purchase(TEXT,CHAR,UUID,TIMESTAMPTZ,TEXT),
    public.fn_tg_review_purchase(TEXT,TEXT,TIMESTAMPTZ,UUID,TEXT),
    public.fn_tg_review_order(UUID,TEXT,TIMESTAMPTZ,UUID,TEXT,JSONB)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_purchase_order_json(UUID),
    public.fn_tg_purchase_network_quote(UUID),
    public.fn_tg_bind_purchase_network_quote(UUID,TEXT),
    public.tg_valid_purchase_crypto_checkout(JSONB),
    public.fn_tg_save_purchase_crypto_checkout(UUID,UUID,TEXT,JSONB),
    public.fn_tg_confirm_purchase_payment(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,JSONB),
    public.fn_tg_close_purchase(TEXT,CHAR,UUID,TIMESTAMPTZ,TEXT),
    public.fn_tg_review_purchase(TEXT,TEXT,TIMESTAMPTZ,UUID,TEXT),
    public.fn_tg_review_order(UUID,TEXT,TIMESTAMPTZ,UUID,TEXT,JSONB)
    TO service_role;
COMMIT;
