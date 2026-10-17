BEGIN;

-- Append-only follow-up to the USDT and fee migrations. Existing immutable
-- quotes keep their saved deadlines; only NEW checkouts lose the artificial cap.
-- Does not enable sales, create orders, refund, transfer or fulfill anything.
LOCK TABLE public.tg_purchase_orders IN ACCESS EXCLUSIVE MODE;
ALTER TABLE public.tg_purchase_orders
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
    DROP CONSTRAINT IF EXISTS tg_purchase_orders_payment_status_check;
ALTER TABLE public.tg_purchase_orders
    ADD CONSTRAINT tg_purchase_orders_payment_status_check CHECK (
        payment_status IN ('awaiting_payment', 'checkout_creating', 'paid', 'manual_review', 'expired', 'cancelled')),
    ADD CONSTRAINT tg_purchase_orders_cancelled_check CHECK (
        (payment_status <> 'cancelled' OR (cancelled_at IS NOT NULL AND paid_at IS NULL))
        AND (cancelled_at IS NULL OR payment_status IN ('cancelled', 'manual_review')));

CREATE OR REPLACE FUNCTION public.tg_guard_purchase_cancellation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.cancelled_at IS NOT NULL AND (NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
        OR NEW.payment_status NOT IN ('cancelled', 'manual_review')) THEN
        RAISE EXCEPTION 'TG cancelled purchase cannot be reopened' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tg_purchase_cancellation ON public.tg_purchase_orders;
CREATE TRIGGER trg_tg_purchase_cancellation BEFORE UPDATE ON public.tg_purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_purchase_cancellation();

CREATE OR REPLACE FUNCTION public.fn_tg_cancel_purchase(
    p_order_no TEXT, p_status_token_hash CHAR(64), p_provider_trade_no TEXT, p_provider_checked BOOLEAN
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_order public.tg_purchase_orders%ROWTYPE;
BEGIN
    IF coalesce(p_order_no, '') !~ '^TGP-[A-Z0-9]{20}$'
       OR coalesce(p_status_token_hash, '') !~ '^[a-f0-9]{64}$' THEN
        RETURN jsonb_build_object('success', false, 'code', 'not_found');
    END IF;
    -- No trade lock is needed: cancellation never changes trade identity. It
    -- takes purchase then fulfillment, matching the worker/settlement lock order.
    SELECT * INTO v_order FROM public.tg_purchase_orders
    WHERE order_no = p_order_no AND status_token_hash = p_status_token_hash FOR UPDATE;
    IF v_order.id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'not_found'); END IF;
    IF v_order.payment_status = 'cancelled' THEN
        RETURN jsonb_build_object('success', true, 'existing', true, 'order', public.tg_purchase_order_json(v_order.id));
    END IF;
    IF v_order.payment_status NOT IN ('awaiting_payment', 'expired') OR v_order.paid_at IS NOT NULL
       OR v_order.provider_trade_no IS DISTINCT FROM p_provider_trade_no
       OR (v_order.provider_trade_no IS NOT NULL AND p_provider_checked IS DISTINCT FROM true)
       OR (v_order.provider_trade_no IS NULL AND (v_order.checkout_started_at IS NOT NULL
           OR v_order.checkout_url IS NOT NULL OR v_order.crypto_checkout IS NOT NULL))
       OR EXISTS (SELECT 1 FROM public.tg_redemption_orders WHERE purchase_id = v_order.id) THEN
        RETURN jsonb_build_object('success', false, 'code', 'cancel_not_allowed');
    END IF;
    -- Preserve private provider bindings for late signed callbacks. Public API
    -- serialization removes the payment URL and address for this terminal state.
    UPDATE public.tg_purchase_orders SET payment_status = 'cancelled', cancelled_at = now(),
        last_error_code = 'purchase_cancelled', checkout_lease_token = NULL,
        checkout_lease_expires_at = NULL, updated_at = now() WHERE id = v_order.id;
    INSERT INTO public.tg_audit_events(event_type, target_type, target_id, metadata)
    VALUES ('purchase_cancelled', 'purchase_order', v_order.id,
        jsonb_build_object('provider_checked', coalesce(p_provider_checked, false)));
    RETURN jsonb_build_object('success', true, 'existing', false, 'order', public.tg_purchase_order_json(v_order.id));
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
           OR p_verified_payload->>'price_currency' IS DISTINCT FROM 'usd'
           OR p_verified_payload->>'price_amount_minor' IS DISTINCT FROM v_order.crypto_checkout->>'price_amount_minor'
           OR p_verified_payload->>'pay_currency' IS DISTINCT FROM 'usdtbsc'
           OR p_verified_payload->>'actually_paid_currency' IS DISTINCT FROM 'usdtbsc'
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

REVOKE ALL ON FUNCTION public.tg_guard_purchase_cancellation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tg_cancel_purchase(TEXT, CHAR(64), TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_cancel_purchase(TEXT, CHAR(64), TEXT, BOOLEAN) TO service_role;
-- Replacing functions preserves their existing ACLs; restate the intended grants.
REVOKE ALL ON FUNCTION public.fn_tg_save_purchase_crypto_checkout(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_save_purchase_crypto_checkout(UUID, UUID, TEXT, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_confirm_purchase_payment(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_confirm_purchase_payment(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, JSONB) TO service_role;

DO $$
DECLARE v_source TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tg_purchase_orders'::regclass
        AND conname = 'tg_purchase_orders_cancelled_check')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tg_purchase_orders'::regclass
        AND tgname = 'trg_tg_purchase_cancellation' AND tgenabled = 'O') THEN
        RAISE EXCEPTION 'TG cancellation guards missing';
    END IF;
    v_source := pg_get_functiondef('public.fn_tg_save_purchase_crypto_checkout(uuid,uuid,text,jsonb)'::regprocedure);
    IF position('5 minutes' IN v_source) > 0
       OR position('> v_order.payment_expires_at' IN v_source) = 0 THEN
        RAISE EXCEPTION 'TG checkout expiry contract mismatch';
    END IF;
    v_source := pg_get_functiondef('public.fn_tg_confirm_purchase_payment(text,text,text,text,text,bigint,text,jsonb)'::regprocedure);
    IF position('v_order.cancelled_at IS NOT NULL' IN v_source) = 0
       OR position('payment_received_after_cancellation' IN v_source) = 0
       OR position('v_order.total_minor IS DISTINCT FROM p_amount_minor' IN v_source) = 0
       OR position('signed_notify_and_query' IN v_source) = 0
       OR position('INSERT INTO public.tg_redemption_orders' IN v_source) < position('v_order.cancelled_at IS NOT NULL' IN v_source) THEN
        RAISE EXCEPTION 'TG cancelled settlement contract mismatch';
    END IF;
    v_source := pg_get_functiondef('public.fn_tg_cancel_purchase(text,character,text,boolean)'::regprocedure);
    IF position('status_token_hash = p_status_token_hash FOR UPDATE' IN v_source) = 0
       OR position('p_provider_checked IS DISTINCT FROM true' IN v_source) = 0
       OR position('v_order.paid_at IS NOT NULL' IN v_source) = 0 THEN
        RAISE EXCEPTION 'TG cancel authentication/locking contract mismatch';
    END IF;
    IF has_function_privilege('anon', 'public.fn_tg_cancel_purchase(text,character,text,boolean)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_tg_cancel_purchase(text,character,text,boolean)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.fn_tg_cancel_purchase(text,character,text,boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'TG cancellation RPC privilege mismatch';
    END IF;
    IF EXISTS (SELECT 1 FROM public.tg_purchase_orders p
        WHERE p.cancelled_at IS NOT NULL AND (p.payment_status NOT IN ('cancelled', 'manual_review')
            OR EXISTS (SELECT 1 FROM public.tg_redemption_orders f WHERE f.purchase_id = p.id))) THEN
        RAISE EXCEPTION 'TG cancelled purchase has fulfillment or reopened payment';
    END IF;
END;
$$;

COMMIT;
