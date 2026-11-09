-- Local hardening candidate. Not applied to any database.
BEGIN;

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
    -- This RPC is service-only. Signature AND authenticated query checks precede the call;
    -- it never accepts a browser redirect as proof of payment.
    IF coalesce(p_order_no, '') !~ '^TGP-[A-Z0-9]{20}$'
       OR NOT coalesce((p_provider = 'zpay' AND p_payment_channel IN ('alipay', 'wxpay') AND p_merchant_id ~ '^[0-9]{1,32}$')
          OR (p_provider = 'nowpayments' AND p_payment_channel = 'usdt_bep20' AND p_merchant_id ~ '^nowpayments:[0-9a-f]{64}$'), false)
       OR coalesce(p_provider_trade_no, '') !~ '^[A-Za-z0-9_-]{1,200}$'
       OR p_amount_minor IS NULL OR p_amount_minor < 1 OR p_currency IS DISTINCT FROM 'CNY'
       OR jsonb_typeof(p_verified_payload) IS DISTINCT FROM 'object'
       OR (p_provider = 'zpay' AND p_verified_payload->>'verified_by' IS DISTINCT FROM 'authenticated_query')
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

REVOKE ALL ON FUNCTION public.fn_tg_confirm_purchase_payment(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_confirm_purchase_payment(TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,JSONB) TO service_role;

COMMIT;
