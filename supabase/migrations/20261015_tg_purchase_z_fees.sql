-- 10. TG channel fees. Apply manually AFTER 20261015_tg_purchase_usdt_payments.sql.
-- Does not enable sales, start workers or change existing payable amounts.
-- Legacy quotes cannot create a new purchase; existing orders remain queryable/payable.
BEGIN;
LOCK TABLE public.tg_purchase_quotes, public.tg_purchase_orders IN ACCESS EXCLUSIVE MODE;
ALTER TABLE public.tg_purchase_quotes
    ADD COLUMN IF NOT EXISTS subtotal_minor BIGINT,
    ADD COLUMN IF NOT EXISTS payment_fee_minor BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS payment_fee_rate_bps INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS payment_channel TEXT;
ALTER TABLE public.tg_purchase_orders
    ADD COLUMN IF NOT EXISTS subtotal_minor BIGINT,
    ADD COLUMN IF NOT EXISTS payment_fee_minor BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS payment_fee_rate_bps INTEGER NOT NULL DEFAULT 0;
-- Backfill disclosure fields only. Never reprice or recreate existing payments.
ALTER TABLE public.tg_purchase_quotes DISABLE TRIGGER trg_tg_purchase_quote_identity;
ALTER TABLE public.tg_purchase_orders DISABLE TRIGGER trg_tg_purchase_order_identity;
UPDATE public.tg_purchase_quotes SET subtotal_minor = total_minor WHERE subtotal_minor IS NULL;
UPDATE public.tg_purchase_orders SET subtotal_minor = total_minor WHERE subtotal_minor IS NULL;
ALTER TABLE public.tg_purchase_quotes ENABLE TRIGGER trg_tg_purchase_quote_identity;
ALTER TABLE public.tg_purchase_orders ENABLE TRIGGER trg_tg_purchase_order_identity;
ALTER TABLE public.tg_purchase_quotes ALTER COLUMN subtotal_minor SET NOT NULL;
ALTER TABLE public.tg_purchase_orders ALTER COLUMN subtotal_minor SET NOT NULL;
ALTER TABLE public.tg_purchase_quotes
    DROP CONSTRAINT IF EXISTS tg_purchase_quotes_entitlement_check,
    ADD CONSTRAINT tg_purchase_quotes_entitlement_check CHECK (
        (product_family = 'telegram_premium' AND term_months IS NOT NULL AND term_months IN (3, 6, 12)
            AND product_key = 'premium_' || term_months::TEXT AND stars_quantity IS NULL AND unit_price_micros IS NULL)
        OR (product_family = 'telegram_stars' AND product_key = 'stars' AND term_months IS NULL
            AND stars_quantity IS NOT NULL AND stars_quantity BETWEEN 50 AND 1000000
            AND unit_price_micros IS NOT NULL AND unit_price_micros BETWEEN 1 AND 1000000000
            AND subtotal_minor = ceil(unit_price_micros::NUMERIC * stars_quantity / 10000)::BIGINT)),
    DROP CONSTRAINT IF EXISTS tg_purchase_quotes_fees_check,
    ADD CONSTRAINT tg_purchase_quotes_fees_check CHECK (
        subtotal_minor BETWEEN 1 AND 100000000 AND total_minor = subtotal_minor + payment_fee_minor
        AND payment_fee_minor = ceil(subtotal_minor::NUMERIC * payment_fee_rate_bps / 10000)::BIGINT
        AND ((payment_channel IS NULL AND payment_fee_rate_bps = 0)
            OR (payment_channel IS NOT NULL AND payment_channel IN ('alipay', 'wxpay', 'usdt_bep20')
                AND payment_fee_rate_bps = CASE WHEN payment_channel IN ('alipay', 'usdt_bep20') THEN 100 ELSE 0 END)));
ALTER TABLE public.tg_purchase_orders
    DROP CONSTRAINT IF EXISTS tg_purchase_orders_fees_check,
    ADD CONSTRAINT tg_purchase_orders_fees_check CHECK (
        subtotal_minor BETWEEN 1 AND 100000000 AND total_minor = subtotal_minor + payment_fee_minor
        AND payment_fee_rate_bps IN (0, 100)
        AND (payment_channel IN ('alipay', 'usdt_bep20') OR payment_fee_rate_bps = 0)
        AND payment_fee_minor = ceil(subtotal_minor::NUMERIC * payment_fee_rate_bps / 10000)::BIGINT);


CREATE OR REPLACE FUNCTION public.tg_guard_purchase_identity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_quote public.tg_purchase_quotes%ROWTYPE;
BEGIN
    IF TG_TABLE_NAME = 'tg_purchase_quotes' THEN
        RAISE EXCEPTION 'TG quote snapshot is immutable' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.order_no IS DISTINCT FROM OLD.order_no
           OR NEW.quote_id IS DISTINCT FROM OLD.quote_id OR NEW.product_key IS DISTINCT FROM OLD.product_key
           OR NEW.product_family IS DISTINCT FROM OLD.product_family OR NEW.term_months IS DISTINCT FROM OLD.term_months
           OR NEW.stars_quantity IS DISTINCT FROM OLD.stars_quantity OR NEW.telegram_username IS DISTINCT FROM OLD.telegram_username
           OR NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor
           OR NEW.payment_fee_minor IS DISTINCT FROM OLD.payment_fee_minor
           OR NEW.payment_fee_rate_bps IS DISTINCT FROM OLD.payment_fee_rate_bps
           OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.total_minor IS DISTINCT FROM OLD.total_minor
           OR NEW.price_version IS DISTINCT FROM OLD.price_version OR NEW.status_token_hash IS DISTINCT FROM OLD.status_token_hash
           OR NEW.idempotency_key_hash IS DISTINCT FROM OLD.idempotency_key_hash
           OR NEW.payment_provider IS DISTINCT FROM OLD.payment_provider OR NEW.payment_merchant_id IS DISTINCT FROM OLD.payment_merchant_id
           OR NEW.payment_channel IS DISTINCT FROM OLD.payment_channel OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR NEW.payment_expires_at IS DISTINCT FROM OLD.payment_expires_at THEN
            RAISE EXCEPTION 'TG purchase identity is immutable' USING ERRCODE = '23514';
        END IF;
        IF OLD.payment_status = 'paid' AND (NEW.payment_status <> 'paid'
            OR NEW.provider_trade_no IS DISTINCT FROM OLD.provider_trade_no OR NEW.paid_at IS DISTINCT FROM OLD.paid_at) THEN
            RAISE EXCEPTION 'TG verified payment cannot be reversed' USING ERRCODE = '23514';
        END IF;
        IF OLD.provider_trade_no IS NOT NULL AND NEW.provider_trade_no IS DISTINCT FROM OLD.provider_trade_no THEN
            RAISE EXCEPTION 'TG payment trade identity is immutable' USING ERRCODE = '23514';
        END IF;
    END IF;
    SELECT * INTO v_quote FROM public.tg_purchase_quotes WHERE id = NEW.quote_id;
    IF TG_OP = 'INSERT' AND v_quote.payment_channel IS NULL THEN
        RAISE EXCEPTION 'TG legacy quote cannot create a new purchase' USING ERRCODE = '23514';
    END IF;
    IF v_quote.id IS NULL OR NEW.product_key IS DISTINCT FROM v_quote.product_key
       OR NEW.product_family IS DISTINCT FROM v_quote.product_family OR NEW.term_months IS DISTINCT FROM v_quote.term_months
       OR NEW.stars_quantity IS DISTINCT FROM v_quote.stars_quantity OR NEW.telegram_username IS DISTINCT FROM v_quote.telegram_username
       OR NEW.currency IS DISTINCT FROM v_quote.currency OR NEW.total_minor IS DISTINCT FROM v_quote.total_minor
       OR NEW.price_version IS DISTINCT FROM v_quote.price_version
       OR NEW.subtotal_minor IS DISTINCT FROM v_quote.subtotal_minor
       OR NEW.payment_fee_minor IS DISTINCT FROM v_quote.payment_fee_minor
       OR NEW.payment_fee_rate_bps IS DISTINCT FROM v_quote.payment_fee_rate_bps
       OR (v_quote.payment_channel IS NOT NULL AND NEW.payment_channel IS DISTINCT FROM v_quote.payment_channel) THEN
        RAISE EXCEPTION 'TG purchase does not match immutable quote' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
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
        'paid_at', p.paid_at, 'created_at', p.created_at, 'updated_at', p.updated_at,
        'fulfillment_status', coalesce(f.status, 'not_started'), 'fulfillment_order_no', f.order_no)
    FROM public.tg_purchase_orders p LEFT JOIN public.tg_redemption_orders f ON f.purchase_id = p.id
    WHERE p.id = p_order_id;
$$;

-- Keep the old RPC signature for explicit fail-closed responses to stale clients.
CREATE OR REPLACE FUNCTION public.fn_tg_purchase_quote(
    p_product_family TEXT, p_term_months INTEGER, p_stars_quantity INTEGER, p_username TEXT
)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT jsonb_build_object('success', false, 'code', 'quote_stale');
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_purchase_quote(
    p_product_family TEXT, p_term_months INTEGER, p_stars_quantity INTEGER, p_username TEXT, p_payment_channel TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_product public.tg_purchase_products%ROWTYPE;
    v_quote public.tg_purchase_quotes%ROWTYPE;
    v_username TEXT := lower(regexp_replace(trim(coalesce(p_username, '')), '^@', ''));
    v_subtotal NUMERIC;
    v_fee BIGINT;
    v_rate INTEGER;
    v_total NUMERIC;
    v_key TEXT;
BEGIN
    IF p_payment_channel IS NULL OR p_payment_channel NOT IN ('alipay', 'wxpay', 'usdt_bep20') THEN
        RETURN jsonb_build_object('success', false, 'code', 'payment_channel_invalid');
    END IF;
    IF v_username !~ '^[a-z0-9_]{5,32}$' THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_username');
    END IF;
    IF p_product_family = 'telegram_premium' AND p_term_months IN (3, 6, 12) AND p_stars_quantity IS NULL THEN
        v_key := 'premium_' || p_term_months::TEXT;
    ELSIF p_product_family = 'telegram_stars' AND p_term_months IS NULL AND p_stars_quantity BETWEEN 50 AND 1000000 THEN
        v_key := 'stars';
    ELSE
        RETURN jsonb_build_object('success', false, 'code', 'invalid_product');
    END IF;
    SELECT * INTO v_product FROM public.tg_purchase_products WHERE product_key = v_key FOR SHARE;
    IF v_product.product_key IS NULL OR NOT v_product.enabled THEN
        RETURN jsonb_build_object('success', false, 'code', 'product_unavailable');
    END IF;
    IF v_key = 'stars' AND (p_stars_quantity < v_product.min_stars OR p_stars_quantity > v_product.max_stars) THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_stars_quantity');
    END IF;
    v_subtotal := CASE WHEN v_key = 'stars' THEN ceil(v_product.unit_price_micros::NUMERIC * p_stars_quantity / 10000)
        ELSE v_product.price_minor END;
    v_rate := CASE WHEN p_payment_channel IN ('alipay', 'usdt_bep20') THEN 100 ELSE 0 END;
    v_fee := ceil(v_subtotal * v_rate / 10000)::BIGINT;
    v_total := v_subtotal + v_fee;
    IF v_total IS NULL OR v_total < 1 OR v_total > 100000000 THEN
        RETURN jsonb_build_object('success', false, 'code', 'price_unavailable');
    END IF;
    INSERT INTO public.tg_purchase_quotes (product_key, product_family, term_months, stars_quantity, telegram_username,
        currency, total_minor, subtotal_minor, payment_fee_minor, payment_fee_rate_bps, payment_channel, unit_price_micros, price_version, expires_at)
    VALUES (v_key, v_product.product_family, p_term_months, p_stars_quantity, v_username,
        v_product.currency, v_total::BIGINT, v_subtotal::BIGINT, v_fee, v_rate, p_payment_channel, v_product.unit_price_micros, v_product.price_version, now() + interval '10 minutes')
    RETURNING * INTO v_quote;
    RETURN jsonb_build_object('success', true, 'quote', jsonb_build_object('quote_id', v_quote.id,
        'product_family', v_quote.product_family, 'term_months', v_quote.term_months, 'stars_quantity', v_quote.stars_quantity,
        'username', v_quote.telegram_username, 'currency', v_quote.currency, 'total_minor', v_quote.total_minor,
        'subtotal_minor', v_quote.subtotal_minor, 'payment_fee_minor', v_quote.payment_fee_minor,
        'payment_fee_rate_bps', v_quote.payment_fee_rate_bps, 'payment_channel', v_quote.payment_channel,
        'price_version', v_quote.price_version, 'expires_at', v_quote.expires_at));
END;
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
    IF v_quote.payment_channel IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'quote_stale');
    END IF;
    -- Bind the quote to the exact recipient, product, quantity and price that
    -- the buyer confirmed before a payable order can be persisted.
    IF v_quote.product_key IS DISTINCT FROM p_expected_product_key
       OR v_quote.telegram_username IS DISTINCT FROM p_expected_username
       OR v_quote.total_minor IS DISTINCT FROM p_expected_total_minor
       OR v_quote.price_version IS DISTINCT FROM p_expected_price_version
       OR v_quote.stars_quantity IS DISTINCT FROM p_expected_stars_quantity
       OR v_quote.payment_channel IS DISTINCT FROM p_payment_channel THEN
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
        telegram_username, currency, total_minor, subtotal_minor, payment_fee_minor, payment_fee_rate_bps, price_version, status_token_hash, idempotency_key_hash,
        payment_channel, payment_provider, payment_merchant_id)
    VALUES ('TGP-' || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 20)), v_quote.id, v_quote.product_key,
        v_quote.product_family, v_quote.term_months, v_quote.stars_quantity, v_quote.telegram_username,
        v_quote.currency, v_quote.total_minor, v_quote.subtotal_minor, v_quote.payment_fee_minor, v_quote.payment_fee_rate_bps, v_quote.price_version, p_status_token_hash, p_idempotency_key_hash,
        p_payment_channel, p_payment_provider, p_payment_merchant_id) RETURNING * INTO v_order;
    INSERT INTO public.tg_audit_events(event_type, target_type, target_id, metadata)
    VALUES ('purchase_created', 'purchase_order', v_order.id,
        jsonb_build_object('product_family', v_order.product_family, 'total_minor', v_order.total_minor, 'currency', v_order.currency));
    RETURN jsonb_build_object('success', true, 'existing', false, 'order', public.tg_purchase_order_json(v_order.id));
END;
$$;

CREATE OR REPLACE VIEW public.tg_purchase_order_stats AS
SELECT p.id, p.order_no, p.product_key, p.telegram_username, p.product_family,
    p.term_months, p.stars_quantity, p.currency, p.total_minor, p.payment_channel,
    p.payment_status, coalesce(f.status, 'not_started') AS fulfillment_status,
    p.created_at, p.updated_at, p.payment_expires_at AS expires_at, p.price_version,
    p.subtotal_minor, p.payment_fee_minor, p.payment_fee_rate_bps
FROM public.tg_purchase_orders p
LEFT JOIN public.tg_redemption_orders f ON f.purchase_id = p.id;

REVOKE ALL ON FUNCTION public.fn_tg_purchase_quote(TEXT, INTEGER, INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_purchase_quote(TEXT, INTEGER, INTEGER, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_purchase_quote(TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_purchase_quote(TEXT, INTEGER, INTEGER, TEXT) TO service_role;
REVOKE ALL ON TABLE public.tg_purchase_order_stats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tg_purchase_order_stats TO service_role;


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
