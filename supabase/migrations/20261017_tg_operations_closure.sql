-- Apply AFTER 20261015_tg_purchase_usdt_payments.sql and all preceding TG migrations.
-- Operator-applied migration. No switches are enabled and no existing order is replayed.
BEGIN;
ALTER TABLE public.tg_purchase_orders
    DROP CONSTRAINT IF EXISTS tg_purchase_orders_payment_status_check,
    ADD CONSTRAINT tg_purchase_orders_payment_status_check CHECK (
        payment_status IN ('awaiting_payment', 'checkout_creating', 'paid', 'manual_review', 'expired', 'cancelled'));

CREATE OR REPLACE FUNCTION public.tg_purchase_order_json(p_order_id UUID)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT jsonb_build_object('id', p.id, 'order_no', p.order_no, 'quote_id', p.quote_id,
        'product_family', p.product_family, 'term_months', p.term_months, 'stars_quantity', p.stars_quantity,
        'telegram_username', p.telegram_username, 'currency', p.currency, 'total_minor', p.total_minor,
        'price_version', p.price_version, 'payment_channel', p.payment_channel,
        'payment_provider', p.payment_provider, 'payment_merchant_id', p.payment_merchant_id,
        'payment_status', p.payment_status, 'checkout_url', p.checkout_url, 'crypto_checkout', p.crypto_checkout, 'provider_trade_no', p.provider_trade_no,
        'payment_expires_at', p.payment_expires_at, 'expires_at', p.payment_expires_at,
        'paid_at', p.paid_at, 'created_at', p.created_at, 'updated_at', p.updated_at,
        'can_close', p.payment_status IN ('awaiting_payment', 'expired') AND p.paid_at IS NULL
            AND p.checkout_lease_token IS NULL AND p.last_error_code IS NULL AND f.id IS NULL,
        'fulfillment_status', coalesce(f.status, 'not_started'), 'fulfillment_order_no', f.order_no)
    FROM public.tg_purchase_orders p LEFT JOIN public.tg_redemption_orders f ON f.purchase_id = p.id
    WHERE p.id = p_order_id;
$$;

-- Preview is a read-only hint, never a reservation or authorization to redeem.
-- Expired, never-submitted reservations remain previewable; reserve_code alone
-- rechecks and reclaims them under its existing source/order transaction locks.
CREATE OR REPLACE FUNCTION public.fn_tg_preview_code(p_code_digest CHAR(64))
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_product RECORD;
BEGIN
    IF coalesce(p_code_digest, '') !~ '^[0-9a-f]{64}$' THEN
        RETURN jsonb_build_object('success', false, 'code', 'code_unavailable');
    END IF;
    SELECT b.product_family, b.term_months, b.stars_quantity,
        least(c.expires_at, b.valid_until) AS expires_at INTO v_product
    FROM public.tg_redemption_codes c JOIN public.tg_redemption_batches b ON b.id = c.batch_id
    WHERE c.code_digest = p_code_digest AND b.status = 'active' AND b.valid_from <= now()
        AND (c.status = 'available' OR (c.status = 'reserved'
            AND c.reservation_expires_at <= now()
            AND EXISTS (SELECT 1 FROM public.tg_redemption_orders o
                WHERE o.code_id = c.id AND o.status = 'pending' AND o.order_source = 'redemption'
                    AND o.submitted_at IS NULL AND o.provider_order_id IS NULL
                    AND o.provider_payment_currency IS NULL AND o.attempt_count = 0
                    AND o.lease_token IS NULL
                    AND NOT EXISTS (SELECT 1 FROM public.tg_fulfillment_attempts a WHERE a.order_id = o.id))))
        AND (c.expires_at IS NULL OR c.expires_at > now())
        AND (b.valid_until IS NULL OR b.valid_until > now());
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'code', 'code_unavailable'); END IF;
    RETURN jsonb_build_object('success', true, 'product_family', v_product.product_family,
        'term_months', v_product.term_months, 'stars_quantity', v_product.stars_quantity,
        'expires_at', v_product.expires_at);
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
    IF v_order.payment_status NOT IN ('awaiting_payment', 'expired') OR v_order.paid_at IS NOT NULL
       OR v_order.checkout_lease_token IS NOT NULL OR v_order.last_error_code IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.tg_redemption_orders WHERE purchase_id = v_order.id) THEN
        RETURN jsonb_build_object('success', false, 'code', 'close_not_allowed');
    END IF;
    UPDATE public.tg_purchase_orders SET payment_status = 'cancelled', checkout_url = NULL, updated_at = now()
    WHERE id = v_order.id;
    INSERT INTO public.tg_audit_events(actor_user_id, event_type, target_type, target_id, metadata)
    VALUES (p_actor_id, 'purchase_closed', 'purchase_order', v_order.id,
        jsonb_build_object('note', trim(p_note), 'actor', CASE WHEN p_actor_id IS NULL THEN 'customer' ELSE 'admin' END));
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
    IF v_order.payment_status IN ('cancelled', 'manual_review', 'expired') OR v_order.payment_expires_at <= now() OR (p_provider = 'nowpayments'
        AND (v_order.crypto_checkout->>'quote_expires_at')::TIMESTAMPTZ <= now()) THEN
        -- A real payment after the accepted window is retained for review,
        -- never thrown away or auto-fulfilled under an expired quote.
        UPDATE public.tg_purchase_orders SET payment_status = 'manual_review', provider_trade_no = p_provider_trade_no,
            paid_at = now(), verified_payment = p_verified_payload,
            last_error_code = CASE WHEN v_order.payment_status = 'cancelled' THEN 'payment_received_after_close' ELSE 'payment_received_requires_review' END, checkout_lease_token = NULL, checkout_lease_expires_at = NULL,
            updated_at = now() WHERE id = v_order.id;
        INSERT INTO public.tg_audit_events(event_type, target_type, target_id, metadata)
        VALUES ('purchase_payment_manual_review', 'purchase_order', v_order.id, jsonb_build_object('reason', CASE WHEN v_order.payment_status = 'cancelled' THEN 'payment_received_after_close' ELSE 'payment_received_requires_review' END));
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


-- A verified late payment can be approved once. Browser-supplied payment proof
-- is never used, and the immutable entitlement/price is retained.
CREATE OR REPLACE FUNCTION public.fn_tg_review_purchase(
    p_order_no TEXT, p_action TEXT, p_expected_updated_at TIMESTAMPTZ, p_actor_id UUID, p_note TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_order public.tg_purchase_orders%ROWTYPE; v_fulfillment public.tg_redemption_orders%ROWTYPE;
BEGIN
    IF p_actor_id IS NULL OR p_expected_updated_at IS NULL OR coalesce(p_action, '') NOT IN ('approve_payment', 'note')
       OR coalesce(length(trim(p_note)), 0) NOT BETWEEN 1 AND 500 THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_request');
    END IF;
    SELECT * INTO v_order FROM public.tg_purchase_orders WHERE order_no = p_order_no FOR UPDATE;
    IF v_order.id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'not_found'); END IF;
    IF v_order.updated_at IS DISTINCT FROM p_expected_updated_at THEN
        RETURN jsonb_build_object('success', false, 'code', 'version_conflict');
    END IF;
    IF p_action = 'approve_payment' THEN
        IF v_order.payment_status <> 'manual_review' OR v_order.paid_at IS NULL OR v_order.provider_trade_no IS NULL
           OR v_order.checkout_started_at IS NULL
           OR v_order.verified_payment->>'event_status' IS DISTINCT FROM 'paid'
           OR v_order.verified_payment->>'verified_by' IS DISTINCT FROM (CASE v_order.payment_provider
                WHEN 'zpay' THEN 'signed_notify' WHEN 'nowpayments' THEN 'signed_notify_and_query' ELSE NULL END)
           OR EXISTS (SELECT 1 FROM public.tg_redemption_orders WHERE purchase_id = v_order.id) THEN
            RETURN jsonb_build_object('success', false, 'code', 'payment_unverified');
        END IF;
        UPDATE public.tg_purchase_orders SET payment_status = 'paid', last_error_code = NULL,
            checkout_lease_token = NULL, checkout_lease_expires_at = NULL, updated_at = now() WHERE id = v_order.id;
        INSERT INTO public.tg_redemption_orders(order_no, order_source, purchase_id, code_id, product_family,
            term_months, stars_quantity, telegram_username, status_token_hash, idempotency_key_hash, provider_idempotency_key)
        VALUES ('TG-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 20)), 'purchase', v_order.id, NULL,
            v_order.product_family, v_order.term_months, v_order.stars_quantity, v_order.telegram_username,
            v_order.status_token_hash, encode(sha256(convert_to('tg-purchase:' || v_order.id::TEXT, 'UTF8')), 'hex'),
            'tg-purchase-' || replace(v_order.id::TEXT, '-', '')) RETURNING * INTO v_fulfillment;
    ELSE
        UPDATE public.tg_purchase_orders SET updated_at = now() WHERE id = v_order.id;
    END IF;
    INSERT INTO public.tg_audit_events(actor_user_id, event_type, target_type, target_id, metadata)
    VALUES (p_actor_id, 'purchase_review', 'purchase_order', v_order.id,
        jsonb_build_object('action', p_action, 'note', trim(p_note), 'previous_status', v_order.payment_status,
            'fulfillment_id', v_fulfillment.id));
    RETURN jsonb_build_object('success', true, 'order', public.tg_purchase_order_json(v_order.id));
END;
$$;

-- Manual review uses the worker's existing finalization path under the same
-- source -> order locks. A fresh server-side GET snapshot is mandatory.
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
        IF (v_order.order_source = 'purchase' AND (v_purchase.payment_status IS DISTINCT FROM 'paid' OR v_purchase.paid_at IS NULL))
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
REVOKE ALL ON FUNCTION public.fn_tg_preview_code(CHAR) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_preview_code(CHAR) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_close_purchase(TEXT,CHAR,UUID,TIMESTAMPTZ,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_close_purchase(TEXT,CHAR,UUID,TIMESTAMPTZ,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_review_purchase(TEXT,TEXT,TIMESTAMPTZ,UUID,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_review_purchase(TEXT,TEXT,TIMESTAMPTZ,UUID,TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_review_order(UUID,TEXT,TIMESTAMPTZ,UUID,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_review_order(UUID,TEXT,TIMESTAMPTZ,UUID,TEXT,JSONB) TO service_role;

COMMIT;
