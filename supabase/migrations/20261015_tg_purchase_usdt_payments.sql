-- 9. TG customer USDT payments: run manually after the eight TG migrations.
-- No sales switch, catalog price or enabled flag is changed by this migration.
BEGIN;

ALTER TABLE public.tg_purchase_orders
    ADD COLUMN IF NOT EXISTS crypto_checkout JSONB,
    DROP CONSTRAINT IF EXISTS tg_purchase_orders_payment_channel_check,
    DROP CONSTRAINT IF EXISTS tg_purchase_orders_payment_provider_check,
    DROP CONSTRAINT IF EXISTS tg_purchase_orders_payment_merchant_id_check,
    DROP CONSTRAINT IF EXISTS tg_purchase_orders_payment_identity_check,
    ADD CONSTRAINT tg_purchase_orders_payment_identity_check CHECK (
        (payment_provider = 'zpay' AND payment_channel IN ('alipay', 'wxpay')
            AND payment_merchant_id ~ '^[0-9]{1,32}$')
        OR (payment_provider = 'nowpayments' AND payment_channel = 'usdt_bep20'
            AND payment_merchant_id ~ '^nowpayments:[0-9a-f]{64}$')
    );

CREATE OR REPLACE FUNCTION public.tg_valid_purchase_crypto_checkout(p_checkout JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_checkout IS NULL OR jsonb_typeof(p_checkout) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF NOT (p_checkout ?& ARRAY['payment_id', 'network', 'pay_currency', 'pay_amount', 'pay_address', 'quote_expires_at', 'price_currency', 'price_amount_minor'])
       OR (SELECT count(*) FROM jsonb_object_keys(p_checkout)) <> 8
       OR jsonb_typeof(p_checkout->'payment_id') IS DISTINCT FROM 'string'
       OR coalesce(p_checkout->>'payment_id', '') !~ '^[0-9]{1,32}$'
       OR p_checkout->>'network' IS DISTINCT FROM 'BSC (BEP20)'
       OR p_checkout->>'pay_currency' IS DISTINCT FROM 'usdtbsc'
       OR p_checkout->>'price_currency' IS DISTINCT FROM 'usd'
       OR jsonb_typeof(p_checkout->'pay_amount') IS DISTINCT FROM 'string'
       OR coalesce(p_checkout->>'pay_amount', '') !~ '^(0|[1-9][0-9]{0,12})([.][0-9]{1,18})?$'
       OR jsonb_typeof(p_checkout->'price_amount_minor') IS DISTINCT FROM 'number'
       OR coalesce(p_checkout->>'price_amount_minor', '') !~ '^[1-9][0-9]{0,9}$'
       OR coalesce(p_checkout->>'pay_address', '') !~ '^0x[0-9a-fA-F]{40}$'
       OR coalesce(p_checkout->>'quote_expires_at', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,3})?Z$' THEN RETURN false; END IF;
    RETURN (p_checkout->>'pay_amount')::NUMERIC > 0
        AND (p_checkout->>'price_amount_minor')::BIGINT BETWEEN 1 AND 1000000000
        AND (p_checkout->>'quote_expires_at')::TIMESTAMPTZ IS NOT NULL;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
    RETURN false;
END;
$$;

ALTER TABLE public.tg_purchase_orders
    DROP CONSTRAINT IF EXISTS tg_purchase_orders_crypto_checkout_check,
    ADD CONSTRAINT tg_purchase_orders_crypto_checkout_check CHECK (crypto_checkout IS NULL
        OR (payment_provider = 'nowpayments' AND checkout_url IS NULL
            AND public.tg_valid_purchase_crypto_checkout(crypto_checkout)
            AND provider_trade_no IS NOT NULL AND provider_trade_no = crypto_checkout->>'payment_id'));

CREATE OR REPLACE FUNCTION public.tg_guard_purchase_crypto_identity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.crypto_checkout IS NOT NULL AND NEW.crypto_checkout IS DISTINCT FROM OLD.crypto_checkout THEN
        RAISE EXCEPTION 'TG crypto quote is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.crypto_checkout IS NULL AND NEW.crypto_checkout IS NOT NULL
       AND (OLD.payment_status <> 'checkout_creating' OR OLD.checkout_lease_token IS NULL
           OR OLD.checkout_lease_expires_at <= now()) THEN
        RAISE EXCEPTION 'TG crypto quote requires checkout lease' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tg_purchase_crypto_identity ON public.tg_purchase_orders;
CREATE TRIGGER trg_tg_purchase_crypto_identity BEFORE UPDATE ON public.tg_purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_purchase_crypto_identity();


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
        'fulfillment_status', coalesce(f.status, 'not_started'), 'fulfillment_order_no', f.order_no)
    FROM public.tg_purchase_orders p LEFT JOIN public.tg_redemption_orders f ON f.purchase_id = p.id
    WHERE p.id = p_order_id;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_create_purchase(
    p_quote_id UUID, p_expected_product_key TEXT, p_expected_username TEXT,
    p_expected_total_minor BIGINT, p_expected_price_version BIGINT, p_expected_stars_quantity BIGINT,
    p_status_token_hash CHAR(64), p_idempotency_key_hash CHAR(64),
    p_payment_channel TEXT, p_payment_provider TEXT, p_payment_merchant_id TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_quote public.tg_purchase_quotes%ROWTYPE;
    v_product public.tg_purchase_products%ROWTYPE;
    v_order public.tg_purchase_orders%ROWTYPE;
BEGIN
    IF p_quote_id IS NULL OR coalesce(p_expected_product_key, '') NOT IN ('premium_3', 'premium_6', 'premium_12', 'stars')
       OR coalesce(p_expected_username, '') !~ '^[a-z0-9_]{5,32}$'
       OR p_expected_total_minor IS NULL OR p_expected_total_minor NOT BETWEEN 1 AND 100000000
       OR p_expected_price_version IS NULL OR p_expected_price_version < 1
       OR (p_expected_product_key = 'stars' AND (p_expected_stars_quantity IS NULL OR p_expected_stars_quantity NOT BETWEEN 50 AND 1000000))
       OR (p_expected_product_key <> 'stars' AND p_expected_stars_quantity IS NOT NULL)
       OR coalesce(p_status_token_hash, '') !~ '^[0-9a-f]{64}$'
       OR coalesce(p_idempotency_key_hash, '') !~ '^[0-9a-f]{64}$'
       OR NOT coalesce((p_payment_provider = 'zpay' AND p_payment_channel IN ('alipay', 'wxpay')
            AND p_payment_merchant_id ~ '^[0-9]{1,32}$')
          OR (p_payment_provider = 'nowpayments' AND p_payment_channel = 'usdt_bep20'
            AND p_payment_merchant_id ~ '^nowpayments:[0-9a-f]{64}$'), false) THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_request');
    END IF;
    -- Same idempotency key is serialized even when the callers use different quotes.
    PERFORM pg_advisory_xact_lock(hashtextextended('tg-purchase:' || p_idempotency_key_hash, 0));
    SELECT * INTO v_order FROM public.tg_purchase_orders WHERE idempotency_key_hash = p_idempotency_key_hash;
    IF v_order.id IS NOT NULL THEN
        IF v_order.quote_id IS DISTINCT FROM p_quote_id OR v_order.status_token_hash IS DISTINCT FROM p_status_token_hash
           OR v_order.product_key IS DISTINCT FROM p_expected_product_key
           OR v_order.telegram_username IS DISTINCT FROM p_expected_username
           OR v_order.total_minor IS DISTINCT FROM p_expected_total_minor
           OR v_order.price_version IS DISTINCT FROM p_expected_price_version
           OR v_order.stars_quantity IS DISTINCT FROM p_expected_stars_quantity
           OR v_order.payment_channel IS DISTINCT FROM p_payment_channel OR v_order.payment_provider IS DISTINCT FROM p_payment_provider
           OR v_order.payment_merchant_id IS DISTINCT FROM p_payment_merchant_id THEN
            RETURN jsonb_build_object('success', false, 'code', 'idempotency_conflict');
        END IF;
        RETURN jsonb_build_object('success', true, 'existing', true, 'order', public.tg_purchase_order_json(v_order.id));
    END IF;
    SELECT * INTO v_quote FROM public.tg_purchase_quotes WHERE id = p_quote_id FOR UPDATE;
    IF v_quote.id IS NULL OR v_quote.expires_at <= now() THEN
        RETURN jsonb_build_object('success', false, 'code', 'quote_expired');
    END IF;
    -- Bind the quote to the exact recipient, product, quantity and price that
    -- the buyer confirmed before a payable order can be persisted.
    IF v_quote.product_key IS DISTINCT FROM p_expected_product_key
       OR v_quote.telegram_username IS DISTINCT FROM p_expected_username
       OR v_quote.total_minor IS DISTINCT FROM p_expected_total_minor
       OR v_quote.price_version IS DISTINCT FROM p_expected_price_version
       OR v_quote.stars_quantity IS DISTINCT FROM p_expected_stars_quantity THEN
        RETURN jsonb_build_object('success', false, 'code', 'quote_mismatch');
    END IF;
    IF EXISTS (SELECT 1 FROM public.tg_purchase_orders WHERE quote_id = p_quote_id) THEN
        RETURN jsonb_build_object('success', false, 'code', 'quote_already_used');
    END IF;
    SELECT * INTO v_product FROM public.tg_purchase_products WHERE product_key = v_quote.product_key FOR SHARE;
    IF NOT coalesce(v_product.enabled, false) OR v_product.price_version IS DISTINCT FROM v_quote.price_version THEN
        RETURN jsonb_build_object('success', false, 'code', 'quote_stale');
    END IF;
    INSERT INTO public.tg_purchase_orders (order_no, quote_id, product_key, product_family, term_months, stars_quantity,
        telegram_username, currency, total_minor, price_version, status_token_hash, idempotency_key_hash,
        payment_channel, payment_provider, payment_merchant_id)
    VALUES ('TGP-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 20)), v_quote.id, v_quote.product_key,
        v_quote.product_family, v_quote.term_months, v_quote.stars_quantity, v_quote.telegram_username,
        v_quote.currency, v_quote.total_minor, v_quote.price_version, p_status_token_hash, p_idempotency_key_hash,
        p_payment_channel, p_payment_provider, p_payment_merchant_id) RETURNING * INTO v_order;
    INSERT INTO public.tg_audit_events(event_type, target_type, target_id, metadata)
    VALUES ('purchase_created', 'purchase_order', v_order.id,
        jsonb_build_object('product_family', v_order.product_family, 'total_minor', v_order.total_minor, 'currency', v_order.currency));
    RETURN jsonb_build_object('success', true, 'existing', false, 'order', public.tg_purchase_order_json(v_order.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_save_purchase_checkout(
    p_purchase_id UUID, p_lease_token UUID, p_provider_trade_no TEXT, p_checkout_url TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_order public.tg_purchase_orders%ROWTYPE;
BEGIN
    IF p_purchase_id IS NULL OR p_lease_token IS NULL OR coalesce(p_provider_trade_no, '') !~ '^[A-Za-z0-9_-]{1,200}$'
       OR coalesce(p_checkout_url, '') !~ '^https://[^/@[:space:]]+([/:?]|$)' OR char_length(p_checkout_url) > 4096 THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_checkout');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('tg-payment-trade:' || p_provider_trade_no, 0));
    SELECT * INTO v_order FROM public.tg_purchase_orders WHERE id = p_purchase_id FOR UPDATE;
    IF v_order.id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'not_found'); END IF;
    IF v_order.payment_provider <> 'zpay' THEN RETURN jsonb_build_object('success', false, 'code', 'invalid_checkout'); END IF;
    IF v_order.payment_status = 'paid' AND v_order.provider_trade_no = p_provider_trade_no THEN
        RETURN jsonb_build_object('success', true, 'existing', true, 'order', public.tg_purchase_order_json(v_order.id));
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
    UPDATE public.tg_purchase_orders SET provider_trade_no = p_provider_trade_no, checkout_url = p_checkout_url,
        payment_status = 'awaiting_payment', checkout_lease_token = NULL, checkout_lease_expires_at = NULL, updated_at = now()
    WHERE id = v_order.id;
    RETURN jsonb_build_object('success', true, 'order', public.tg_purchase_order_json(v_order.id));
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
       OR (p_crypto_checkout->>'quote_expires_at')::TIMESTAMPTZ > v_order.payment_expires_at
       OR (p_crypto_checkout->>'quote_expires_at')::TIMESTAMPTZ > now() + interval '5 minutes' THEN
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

REVOKE ALL ON FUNCTION public.tg_valid_purchase_crypto_checkout(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_valid_purchase_crypto_checkout(JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.tg_guard_purchase_crypto_identity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tg_save_purchase_crypto_checkout(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_save_purchase_crypto_checkout(UUID, UUID, TEXT, JSONB) TO service_role;

DO $$
DECLARE v_source TEXT;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tg_purchase_orders'::regclass
        AND conname = 'tg_purchase_orders_payment_identity_check' AND convalidated) THEN
        RAISE EXCEPTION 'TG USDT payment identity constraint missing';
    END IF;
    IF public.tg_valid_purchase_crypto_checkout('{}'::JSONB) OR public.tg_valid_purchase_crypto_checkout(NULL) THEN
        RAISE EXCEPTION 'TG USDT empty quote must fail closed';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tg_purchase_orders'::regclass
        AND tgname = 'trg_tg_purchase_crypto_identity' AND tgenabled <> 'D') THEN
        RAISE EXCEPTION 'TG USDT immutable quote trigger missing';
    END IF;
    SELECT pg_get_functiondef('public.fn_tg_confirm_purchase_payment(text,text,text,text,text,bigint,text,jsonb)'::regprocedure) INTO v_source;
    IF position('signed_notify_and_query' IN v_source) = 0 OR position('actually_paid_currency' IN v_source) = 0
        OR position('quote_expires_at' IN v_source) = 0 THEN RAISE EXCEPTION 'TG USDT settlement verification missing'; END IF;
END;
$$;

COMMIT;
