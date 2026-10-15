-- Seventh TG migration. Apply only after 20261015_tg_stars_redemption.sql.
-- Isolated cash-purchase domain; no shop/wallet row, switch or provider is touched.
-- All seeded products are disabled and have no configured selling price.
BEGIN;

CREATE TABLE IF NOT EXISTS public.tg_purchase_products (
    product_key TEXT PRIMARY KEY CHECK (product_key IN ('premium_3', 'premium_6', 'premium_12', 'stars')),
    product_family TEXT NOT NULL CHECK (product_family IN ('telegram_premium', 'telegram_stars')),
    term_months INTEGER,
    currency TEXT NOT NULL DEFAULT 'CNY' CHECK (currency = 'CNY'),
    price_minor BIGINT,
    unit_price_micros BIGINT,
    min_stars INTEGER NOT NULL DEFAULT 50 CHECK (min_stars BETWEEN 50 AND 1000000),
    max_stars INTEGER NOT NULL DEFAULT 1000000 CHECK (max_stars BETWEEN min_stars AND 1000000),
    enabled BOOLEAN NOT NULL DEFAULT false,
    price_version BIGINT NOT NULL DEFAULT 1 CHECK (price_version > 0),
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tg_purchase_products_identity_check CHECK (
        (product_family = 'telegram_premium' AND term_months IS NOT NULL AND term_months IN (3, 6, 12)
            AND product_key = 'premium_' || term_months::TEXT AND unit_price_micros IS NULL)
        OR (product_family = 'telegram_stars' AND product_key = 'stars' AND term_months IS NULL AND price_minor IS NULL)
    ),
    CONSTRAINT tg_purchase_products_price_check CHECK (
        (price_minor IS NULL OR price_minor BETWEEN 1 AND 100000000)
        AND (unit_price_micros IS NULL OR unit_price_micros BETWEEN 1 AND 1000000000)
        AND (NOT enabled OR (product_family = 'telegram_premium' AND price_minor IS NOT NULL)
            OR (product_family = 'telegram_stars' AND unit_price_micros IS NOT NULL))
    )
);
INSERT INTO public.tg_purchase_products (product_key, product_family, term_months)
VALUES ('premium_3', 'telegram_premium', 3), ('premium_6', 'telegram_premium', 6),
       ('premium_12', 'telegram_premium', 12), ('stars', 'telegram_stars', NULL)
ON CONFLICT (product_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tg_purchase_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_key TEXT NOT NULL REFERENCES public.tg_purchase_products(product_key) ON DELETE RESTRICT,
    product_family TEXT NOT NULL,
    term_months INTEGER,
    stars_quantity INTEGER,
    telegram_username TEXT NOT NULL CHECK (telegram_username ~ '^[a-z0-9_]{5,32}$'),
    currency TEXT NOT NULL CHECK (currency = 'CNY'),
    total_minor BIGINT NOT NULL CHECK (total_minor BETWEEN 1 AND 100000000),
    unit_price_micros BIGINT,
    price_version BIGINT NOT NULL CHECK (price_version > 0),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tg_purchase_quotes_entitlement_check CHECK (
        (product_family = 'telegram_premium' AND term_months IS NOT NULL AND term_months IN (3, 6, 12)
            AND product_key = 'premium_' || term_months::TEXT AND stars_quantity IS NULL AND unit_price_micros IS NULL)
        OR (product_family = 'telegram_stars' AND product_key = 'stars' AND term_months IS NULL
            AND stars_quantity IS NOT NULL AND stars_quantity BETWEEN 50 AND 1000000
            AND unit_price_micros IS NOT NULL AND unit_price_micros BETWEEN 1 AND 1000000000
            AND total_minor = ceil(unit_price_micros::NUMERIC * stars_quantity / 10000)::BIGINT)
    ),
    CONSTRAINT tg_purchase_quotes_expiry_check CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes')
);

CREATE TABLE IF NOT EXISTS public.tg_purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_no TEXT NOT NULL UNIQUE CHECK (order_no ~ '^TGP-[A-Z0-9]{20}$'),
    quote_id UUID NOT NULL UNIQUE REFERENCES public.tg_purchase_quotes(id) ON DELETE RESTRICT,
    product_key TEXT NOT NULL REFERENCES public.tg_purchase_products(product_key) ON DELETE RESTRICT,
    product_family TEXT NOT NULL,
    term_months INTEGER,
    stars_quantity INTEGER,
    telegram_username TEXT NOT NULL CHECK (telegram_username ~ '^[a-z0-9_]{5,32}$'),
    currency TEXT NOT NULL CHECK (currency = 'CNY'),
    total_minor BIGINT NOT NULL CHECK (total_minor BETWEEN 1 AND 100000000),
    price_version BIGINT NOT NULL CHECK (price_version > 0),
    status_token_hash CHAR(64) NOT NULL CHECK (status_token_hash ~ '^[0-9a-f]{64}$'),
    idempotency_key_hash CHAR(64) NOT NULL UNIQUE CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
    payment_channel TEXT NOT NULL CHECK (payment_channel IN ('alipay', 'wxpay')),
    payment_provider TEXT NOT NULL CHECK (payment_provider = 'zpay'),
    payment_merchant_id TEXT NOT NULL CHECK (payment_merchant_id ~ '^[0-9]{1,32}$'),
    payment_status TEXT NOT NULL DEFAULT 'awaiting_payment'
        CHECK (payment_status IN ('awaiting_payment', 'checkout_creating', 'paid', 'manual_review', 'expired')),
    provider_trade_no TEXT CHECK (provider_trade_no IS NULL OR provider_trade_no ~ '^[A-Za-z0-9_-]{1,200}$'),
    checkout_url TEXT CHECK (checkout_url IS NULL OR (char_length(checkout_url) <= 4096 AND checkout_url ~ '^https://[^/@[:space:]]+([/:?]|$)')),
    checkout_lease_token UUID,
    checkout_lease_expires_at TIMESTAMPTZ,
    checkout_started_at TIMESTAMPTZ,
    payment_expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
    paid_at TIMESTAMPTZ,
    verified_payment JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(verified_payment) = 'object'),
    last_error_code TEXT CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tg_purchase_orders_entitlement_check CHECK (
        (product_family = 'telegram_premium' AND term_months IS NOT NULL AND term_months IN (3, 6, 12)
            AND product_key = 'premium_' || term_months::TEXT AND stars_quantity IS NULL)
        OR (product_family = 'telegram_stars' AND product_key = 'stars' AND term_months IS NULL
            AND stars_quantity IS NOT NULL AND stars_quantity BETWEEN 50 AND 1000000)
    ),
    CONSTRAINT tg_purchase_orders_lease_check CHECK ((checkout_lease_token IS NULL) = (checkout_lease_expires_at IS NULL)),
    CONSTRAINT tg_purchase_orders_paid_check CHECK (payment_status <> 'paid' OR (paid_at IS NOT NULL AND provider_trade_no IS NOT NULL AND checkout_started_at IS NOT NULL)),
    CONSTRAINT tg_purchase_orders_expiry_check CHECK (payment_expires_at > created_at AND payment_expires_at <= created_at + interval '15 minutes')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_purchase_orders_provider_trade
    ON public.tg_purchase_orders(payment_provider, payment_merchant_id, provider_trade_no)
    WHERE provider_trade_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tg_purchase_orders_created ON public.tg_purchase_orders(created_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_tg_purchase_orders_payment ON public.tg_purchase_orders(payment_status, payment_expires_at);

ALTER TABLE public.tg_redemption_orders
    ADD COLUMN IF NOT EXISTS order_source TEXT NOT NULL DEFAULT 'redemption',
    ADD COLUMN IF NOT EXISTS purchase_id UUID REFERENCES public.tg_purchase_orders(id) ON DELETE RESTRICT,
    ALTER COLUMN code_id DROP NOT NULL,
    DROP CONSTRAINT IF EXISTS tg_redemption_orders_source_check,
    ADD CONSTRAINT tg_redemption_orders_source_check CHECK (
        (order_source = 'redemption' AND code_id IS NOT NULL AND purchase_id IS NULL)
        OR (order_source = 'purchase' AND code_id IS NULL AND purchase_id IS NOT NULL)
    );
CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_redemption_orders_purchase ON public.tg_redemption_orders(purchase_id)
    WHERE purchase_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_guard_purchase_product()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.price_version := 1;
    ELSE
        IF NEW.product_key IS DISTINCT FROM OLD.product_key OR NEW.product_family IS DISTINCT FROM OLD.product_family
           OR NEW.term_months IS DISTINCT FROM OLD.term_months OR NEW.currency IS DISTINCT FROM OLD.currency THEN
            RAISE EXCEPTION 'TG product identity is immutable' USING ERRCODE = '23514';
        END IF;
        NEW.price_version := OLD.price_version + 1;
        NEW.created_at := OLD.created_at;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tg_purchase_product ON public.tg_purchase_products;
CREATE TRIGGER trg_tg_purchase_product BEFORE INSERT OR UPDATE ON public.tg_purchase_products
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_purchase_product();

CREATE OR REPLACE FUNCTION public.fn_tg_update_price(
    p_product_key TEXT, p_price_minor BIGINT, p_unit_price_micros BIGINT,
    p_sale_enabled BOOLEAN, p_actor_id UUID, p_expected_version BIGINT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_product public.tg_purchase_products%ROWTYPE;
    v_stars BOOLEAN;
BEGIN
    IF p_product_key IS NULL OR p_product_key NOT IN ('premium_3', 'premium_6', 'premium_12', 'stars')
       OR p_sale_enabled IS NULL OR p_actor_id IS NULL OR p_expected_version IS NULL OR p_expected_version < 1 THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_request');
    END IF;
    v_stars := p_product_key = 'stars';
    IF (v_stars AND (p_price_minor IS NOT NULL OR (p_sale_enabled AND (p_unit_price_micros IS NULL OR p_unit_price_micros NOT BETWEEN 1 AND 1000000000))
            OR (p_unit_price_micros IS NOT NULL AND p_unit_price_micros NOT BETWEEN 1 AND 1000000000)))
       OR (NOT v_stars AND (p_unit_price_micros IS NOT NULL OR (p_sale_enabled AND (p_price_minor IS NULL OR p_price_minor NOT BETWEEN 1 AND 100000000))
            OR (p_price_minor IS NOT NULL AND p_price_minor NOT BETWEEN 1 AND 100000000))) THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_price');
    END IF;
    SELECT * INTO v_product FROM public.tg_purchase_products WHERE product_key = p_product_key FOR UPDATE;
    IF v_product.product_key IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'not_found'); END IF;
    IF v_product.price_version IS DISTINCT FROM p_expected_version THEN
        RETURN jsonb_build_object('success', false, 'code', 'version_conflict');
    END IF;
    UPDATE public.tg_purchase_products SET price_minor = p_price_minor, unit_price_micros = p_unit_price_micros,
        enabled = p_sale_enabled, updated_by = p_actor_id
    WHERE product_key = p_product_key RETURNING * INTO v_product;
    RETURN jsonb_build_object('success', true, 'price', jsonb_build_object(
        'product_key', v_product.product_key, 'product_family', v_product.product_family,
        'term_months', v_product.term_months, 'price_minor', v_product.price_minor,
        'unit_price_micros', v_product.unit_price_micros, 'enabled', v_product.enabled,
        'currency', v_product.currency, 'price_version', v_product.price_version,
        'min_stars', v_product.min_stars, 'max_stars', v_product.max_stars, 'updated_at', v_product.updated_at));
END;
$$;

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
    IF v_quote.id IS NULL OR NEW.product_key IS DISTINCT FROM v_quote.product_key
       OR NEW.product_family IS DISTINCT FROM v_quote.product_family OR NEW.term_months IS DISTINCT FROM v_quote.term_months
       OR NEW.stars_quantity IS DISTINCT FROM v_quote.stars_quantity OR NEW.telegram_username IS DISTINCT FROM v_quote.telegram_username
       OR NEW.currency IS DISTINCT FROM v_quote.currency OR NEW.total_minor IS DISTINCT FROM v_quote.total_minor
       OR NEW.price_version IS DISTINCT FROM v_quote.price_version THEN
        RAISE EXCEPTION 'TG purchase does not match immutable quote' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tg_purchase_quote_identity ON public.tg_purchase_quotes;
CREATE TRIGGER trg_tg_purchase_quote_identity BEFORE UPDATE ON public.tg_purchase_quotes
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_purchase_identity();
DROP TRIGGER IF EXISTS trg_tg_purchase_order_identity ON public.tg_purchase_orders;
CREATE TRIGGER trg_tg_purchase_order_identity BEFORE INSERT OR UPDATE ON public.tg_purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_purchase_identity();

-- Extends the sixth-migration guard; redemption semantics and lock order remain intact.
CREATE OR REPLACE FUNCTION public.tg_guard_entitlement_identity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_batch public.tg_redemption_batches%ROWTYPE;
    v_purchase public.tg_purchase_orders%ROWTYPE;
BEGIN
    IF TG_TABLE_NAME = 'tg_redemption_batches' THEN
        IF NEW.product_family IS DISTINCT FROM OLD.product_family OR NEW.term_months IS DISTINCT FROM OLD.term_months
           OR NEW.stars_quantity IS DISTINCT FROM OLD.stars_quantity THEN
            RAISE EXCEPTION 'TG batch entitlement is immutable' USING ERRCODE = '23514';
        END IF;
    ELSIF TG_TABLE_NAME = 'tg_redemption_codes' THEN
        IF NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN
            RAISE EXCEPTION 'TG code batch is immutable' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF TG_OP = 'UPDATE' AND (NEW.code_id IS DISTINCT FROM OLD.code_id
            OR NEW.order_source IS DISTINCT FROM OLD.order_source OR NEW.purchase_id IS DISTINCT FROM OLD.purchase_id
            OR NEW.product_family IS DISTINCT FROM OLD.product_family OR NEW.term_months IS DISTINCT FROM OLD.term_months
            OR NEW.stars_quantity IS DISTINCT FROM OLD.stars_quantity OR NEW.telegram_username IS DISTINCT FROM OLD.telegram_username
            OR NEW.provider_idempotency_key IS DISTINCT FROM OLD.provider_idempotency_key) THEN
            RAISE EXCEPTION 'TG order entitlement is immutable' USING ERRCODE = '23514';
        END IF;
        IF NEW.order_source = 'purchase' THEN
            SELECT * INTO v_purchase FROM public.tg_purchase_orders WHERE id = NEW.purchase_id;
            IF v_purchase.id IS NULL OR v_purchase.payment_status <> 'paid' OR v_purchase.paid_at IS NULL
               OR NEW.code_id IS NOT NULL OR NEW.product_family IS DISTINCT FROM v_purchase.product_family
               OR NEW.term_months IS DISTINCT FROM v_purchase.term_months OR NEW.stars_quantity IS DISTINCT FROM v_purchase.stars_quantity
               OR NEW.telegram_username IS DISTINCT FROM v_purchase.telegram_username THEN
                RAISE EXCEPTION 'TG fulfillment does not match paid purchase' USING ERRCODE = '23514';
            END IF;
        ELSE
            SELECT b.* INTO v_batch FROM public.tg_redemption_batches b JOIN public.tg_redemption_codes c ON c.batch_id = b.id
            WHERE c.id = NEW.code_id;
            IF v_batch.id IS NULL OR NEW.purchase_id IS NOT NULL OR NEW.product_family IS DISTINCT FROM v_batch.product_family
               OR NEW.term_months IS DISTINCT FROM v_batch.term_months OR NEW.stars_quantity IS DISTINCT FROM v_batch.stars_quantity THEN
                RAISE EXCEPTION 'TG order entitlement does not match its code batch' USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tg_order_entitlement_identity ON public.tg_redemption_orders;
CREATE TRIGGER trg_tg_order_entitlement_identity
BEFORE INSERT OR UPDATE OF code_id, order_source, purchase_id, product_family, term_months, stars_quantity, telegram_username, provider_idempotency_key
ON public.tg_redemption_orders FOR EACH ROW EXECUTE FUNCTION public.tg_guard_entitlement_identity();

CREATE OR REPLACE FUNCTION public.tg_purchase_order_json(p_order_id UUID)
RETURNS JSONB LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT jsonb_build_object('id', p.id, 'order_no', p.order_no, 'quote_id', p.quote_id,
        'product_family', p.product_family, 'term_months', p.term_months, 'stars_quantity', p.stars_quantity,
        'telegram_username', p.telegram_username, 'currency', p.currency, 'total_minor', p.total_minor,
        'price_version', p.price_version, 'payment_channel', p.payment_channel,
        'payment_provider', p.payment_provider, 'payment_merchant_id', p.payment_merchant_id,
        'payment_status', p.payment_status, 'checkout_url', p.checkout_url, 'provider_trade_no', p.provider_trade_no,
        'payment_expires_at', p.payment_expires_at, 'expires_at', p.payment_expires_at,
        'paid_at', p.paid_at, 'created_at', p.created_at, 'updated_at', p.updated_at,
        'fulfillment_status', coalesce(f.status, 'not_started'), 'fulfillment_order_no', f.order_no)
    FROM public.tg_purchase_orders p LEFT JOIN public.tg_redemption_orders f ON f.purchase_id = p.id
    WHERE p.id = p_order_id;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_purchase_quote(
    p_product_family TEXT, p_term_months INTEGER, p_stars_quantity INTEGER, p_username TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_product public.tg_purchase_products%ROWTYPE;
    v_quote public.tg_purchase_quotes%ROWTYPE;
    v_username TEXT := lower(regexp_replace(trim(coalesce(p_username, '')), '^@', ''));
    v_total NUMERIC;
    v_key TEXT;
BEGIN
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
    v_total := CASE WHEN v_key = 'stars' THEN ceil(v_product.unit_price_micros::NUMERIC * p_stars_quantity / 10000)
        ELSE v_product.price_minor END;
    IF v_total IS NULL OR v_total < 1 OR v_total > 100000000 THEN
        RETURN jsonb_build_object('success', false, 'code', 'price_unavailable');
    END IF;
    INSERT INTO public.tg_purchase_quotes (product_key, product_family, term_months, stars_quantity, telegram_username,
        currency, total_minor, unit_price_micros, price_version, expires_at)
    VALUES (v_key, v_product.product_family, p_term_months, p_stars_quantity, v_username,
        v_product.currency, v_total::BIGINT, v_product.unit_price_micros, v_product.price_version, now() + interval '10 minutes')
    RETURNING * INTO v_quote;
    RETURN jsonb_build_object('success', true, 'quote', jsonb_build_object('quote_id', v_quote.id,
        'product_family', v_quote.product_family, 'term_months', v_quote.term_months, 'stars_quantity', v_quote.stars_quantity,
        'username', v_quote.telegram_username, 'currency', v_quote.currency, 'total_minor', v_quote.total_minor,
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
       OR coalesce(p_payment_channel, '') NOT IN ('alipay', 'wxpay') OR p_payment_provider IS DISTINCT FROM 'zpay'
       OR coalesce(p_payment_merchant_id, '') !~ '^[0-9]{1,32}$' THEN
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

CREATE OR REPLACE FUNCTION public.fn_tg_claim_purchase_checkout(
    p_purchase_id UUID, p_lease_token UUID, p_lease_seconds INTEGER DEFAULT 120
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_order public.tg_purchase_orders%ROWTYPE;
BEGIN
    IF p_purchase_id IS NULL OR p_lease_token IS NULL OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 600 THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_request');
    END IF;
    SELECT * INTO v_order FROM public.tg_purchase_orders WHERE id = p_purchase_id FOR UPDATE;
    IF v_order.id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'not_found'); END IF;
    IF v_order.checkout_url IS NOT NULL OR v_order.payment_status = 'paid' THEN
        RETURN jsonb_build_object('success', true, 'action', 'existing', 'order', public.tg_purchase_order_json(v_order.id));
    END IF;
    IF v_order.payment_status = 'checkout_creating' AND v_order.checkout_lease_expires_at > now() THEN
        RETURN jsonb_build_object('success', true, 'action', 'busy', 'order', public.tg_purchase_order_json(v_order.id));
    END IF;
    IF v_order.checkout_started_at IS NOT NULL THEN
        UPDATE public.tg_purchase_orders SET payment_status = 'manual_review', last_error_code = 'checkout_result_unknown',
            checkout_lease_token = NULL, checkout_lease_expires_at = NULL, updated_at = now() WHERE id = v_order.id;
        RETURN jsonb_build_object('success', false, 'code', 'payment_manual_review', 'order', public.tg_purchase_order_json(v_order.id));
    END IF;
    IF v_order.payment_status <> 'awaiting_payment' OR v_order.payment_expires_at <= now() THEN
        IF v_order.payment_status = 'awaiting_payment' THEN
            UPDATE public.tg_purchase_orders SET payment_status = 'expired', updated_at = now() WHERE id = v_order.id;
        END IF;
        RETURN jsonb_build_object('success', false, 'code', 'payment_unavailable', 'order', public.tg_purchase_order_json(v_order.id));
    END IF;
    UPDATE public.tg_purchase_orders SET payment_status = 'checkout_creating', checkout_started_at = now(),
        checkout_lease_token = p_lease_token, checkout_lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
    WHERE id = v_order.id;
    RETURN jsonb_build_object('success', true, 'action', 'create', 'order', public.tg_purchase_order_json(v_order.id));
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

CREATE OR REPLACE FUNCTION public.fn_tg_fail_purchase_checkout(
    p_purchase_id UUID, p_lease_token UUID, p_error_code TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id UUID;
BEGIN
    UPDATE public.tg_purchase_orders SET payment_status = 'manual_review',
        last_error_code = CASE WHEN p_error_code ~ '^[a-z0-9_]{1,100}$' THEN p_error_code ELSE 'checkout_result_unknown' END,
        checkout_lease_token = NULL, checkout_lease_expires_at = NULL, updated_at = now()
    WHERE id = p_purchase_id AND checkout_lease_token = p_lease_token AND payment_status = 'checkout_creating'
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('success', v_id IS NOT NULL, 'code', CASE WHEN v_id IS NULL THEN 'lease_lost' ELSE 'manual_review' END);
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
    IF coalesce(p_order_no, '') !~ '^TGP-[A-Z0-9]{20}$' OR p_provider IS DISTINCT FROM 'zpay'
       OR coalesce(p_merchant_id, '') !~ '^[0-9]{1,32}$'
       OR coalesce(p_provider_trade_no, '') !~ '^[A-Za-z0-9_-]{1,200}$'
       OR coalesce(p_payment_channel, '') NOT IN ('alipay', 'wxpay')
       OR p_amount_minor IS NULL OR p_amount_minor < 1 OR p_currency IS DISTINCT FROM 'CNY'
       OR jsonb_typeof(p_verified_payload) IS DISTINCT FROM 'object'
       OR p_verified_payload->>'verified_by' IS DISTINCT FROM 'signed_notify'
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
    IF v_order.payment_status = 'paid' OR v_order.paid_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'existing', true, 'order', public.tg_purchase_order_json(v_order.id));
    END IF;
    IF v_order.payment_expires_at <= now() THEN
        -- A real payment after the accepted window is retained for review,
        -- never thrown away or auto-fulfilled under an expired quote.
        UPDATE public.tg_purchase_orders SET payment_status = 'manual_review', provider_trade_no = p_provider_trade_no,
            paid_at = now(), verified_payment = jsonb_build_object('verified_by', 'signed_notify', 'event_status', 'paid'),
            last_error_code = 'payment_received_after_expiry', checkout_lease_token = NULL, checkout_lease_expires_at = NULL,
            updated_at = now() WHERE id = v_order.id;
        INSERT INTO public.tg_audit_events(event_type, target_type, target_id, metadata)
        VALUES ('purchase_payment_manual_review', 'purchase_order', v_order.id, jsonb_build_object('reason', 'payment_received_after_expiry'));
        RETURN jsonb_build_object('success', true, 'existing', false, 'order', public.tg_purchase_order_json(v_order.id));
    END IF;
    UPDATE public.tg_purchase_orders SET payment_status = 'paid', provider_trade_no = p_provider_trade_no,
        paid_at = now(), verified_payment = jsonb_build_object('verified_by', 'signed_notify', 'event_status', 'paid'),
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

CREATE OR REPLACE FUNCTION public.fn_tg_purchase_status(p_order_no TEXT, p_status_token_hash CHAR(64))
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_order public.tg_purchase_orders%ROWTYPE;
BEGIN
    SELECT * INTO v_order FROM public.tg_purchase_orders
    WHERE order_no = trim(p_order_no) AND status_token_hash = lower(trim(p_status_token_hash)) FOR UPDATE;
    IF v_order.id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'not_found'); END IF;
    -- Expiration ends the normal unpaid flow. Unknown checkout creation and
    -- late/ambiguous payment results stay under review and cannot be retried.
    IF v_order.payment_status = 'checkout_creating' AND v_order.paid_at IS NULL
       AND (v_order.checkout_lease_expires_at IS NULL OR v_order.checkout_lease_expires_at <= now()) THEN
        UPDATE public.tg_purchase_orders SET payment_status = 'manual_review', last_error_code = 'checkout_result_unknown',
            checkout_lease_token = NULL, checkout_lease_expires_at = NULL, updated_at = now() WHERE id = v_order.id;
    ELSIF v_order.payment_status = 'awaiting_payment' AND v_order.paid_at IS NULL
       AND v_order.payment_expires_at <= now() THEN
        UPDATE public.tg_purchase_orders SET payment_status = 'expired', updated_at = now() WHERE id = v_order.id;
    END IF;
    RETURN jsonb_build_object('success', true, 'order', public.tg_purchase_order_json(v_order.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_claim_fulfillment_order(
    p_order_id UUID, p_lease_token UUID, p_lease_seconds INTEGER,
    p_product_families TEXT[], p_order_sources TEXT[]
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.tg_redemption_orders%ROWTYPE;
    v_purchase public.tg_purchase_orders%ROWTYPE;
    v_result JSONB;
    v_action TEXT;
    v_reason TEXT;
BEGIN
    IF p_order_sources IS NULL OR cardinality(p_order_sources) = 0
       OR array_position(p_order_sources, NULL) IS NOT NULL
       OR NOT p_order_sources <@ ARRAY['redemption', 'purchase']::TEXT[]
       OR p_product_families IS NULL OR cardinality(p_product_families) = 0
       OR array_position(p_product_families, NULL) IS NOT NULL
       OR NOT p_product_families <@ ARRAY['telegram_premium', 'telegram_stars']::TEXT[]
       OR p_lease_token IS NULL OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 600 THEN
        RAISE EXCEPTION 'invalid TG worker capability or lease' USING ERRCODE = '22023';
    END IF;
    IF 'redemption' = ANY(p_order_sources) THEN
        -- Existing claim joins codes, so it cannot claim a cash order with NULL code_id.
        v_result := public.fn_tg_claim_order(p_order_id, p_lease_token, p_lease_seconds, p_product_families);
        IF v_result->>'code' IS DISTINCT FROM 'no_order' THEN
            IF v_result->'success' = 'true'::JSONB THEN
                v_result := jsonb_set(v_result, '{order,order_source}', '"redemption"'::JSONB);
            END IF;
            RETURN v_result;
        END IF;
    END IF;
    IF NOT 'purchase' = ANY(p_order_sources) THEN
        RETURN jsonb_build_object('success', false, 'code', 'no_order');
    END IF;
    -- Paid order is always the first row locked, matching callback and finish.
    SELECT p.* INTO v_purchase FROM public.tg_purchase_orders p
    JOIN public.tg_redemption_orders o ON o.purchase_id = p.id
    WHERE (p_order_id IS NULL OR o.id = p_order_id) AND o.order_source = 'purchase' AND o.code_id IS NULL
      AND o.product_family = ANY(p_product_families) AND p.payment_status = 'paid' AND p.paid_at IS NOT NULL
      AND o.status IN ('pending', 'processing', 'retry_waiting') AND o.next_attempt_at <= now()
      AND (o.lease_token IS NULL OR o.lease_expires_at <= now())
    ORDER BY o.next_attempt_at, o.created_at, o.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED;
    IF v_purchase.id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'no_order'); END IF;
    SELECT * INTO v_order FROM public.tg_redemption_orders o
    WHERE o.purchase_id = v_purchase.id AND o.order_source = 'purchase' AND o.code_id IS NULL
      AND (p_order_id IS NULL OR o.id = p_order_id) AND o.product_family = ANY(p_product_families)
      AND o.status IN ('pending', 'processing', 'retry_waiting') AND o.next_attempt_at <= now()
      AND (o.lease_token IS NULL OR o.lease_expires_at <= now())
    LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF v_order.id IS NULL THEN RETURN jsonb_build_object('success', false, 'code', 'no_order'); END IF;
    IF v_order.product_family IS DISTINCT FROM v_purchase.product_family OR v_order.term_months IS DISTINCT FROM v_purchase.term_months
       OR v_order.stars_quantity IS DISTINCT FROM v_purchase.stars_quantity OR v_order.telegram_username IS DISTINCT FROM v_purchase.telegram_username THEN
        RAISE EXCEPTION 'TG cash fulfillment entitlement mismatch' USING ERRCODE = '23514';
    END IF;
    IF v_order.status = 'pending' AND v_order.provider_order_id IS NULL AND v_order.submitted_at IS NULL
       AND v_order.provider_payment_currency IS NULL AND v_order.attempt_count = 0
       AND NOT EXISTS (SELECT 1 FROM public.tg_fulfillment_attempts WHERE order_id = v_order.id) THEN
        v_action := 'buy';
    ELSIF v_order.provider_order_id IS NOT NULL AND v_order.provider_payment_currency IN ('gram', 'usdt') THEN
        v_action := 'poll';
    ELSE
        v_reason := CASE WHEN v_order.provider_payment_currency IS NULL
            AND (v_order.provider_order_id IS NOT NULL OR v_order.submitted_at IS NOT NULL)
            THEN 'provider_payment_currency_unconfirmed' ELSE 'provider_result_unknown' END;
        UPDATE public.tg_redemption_orders SET status = 'manual_review', lease_token = NULL, lease_expires_at = NULL,
            last_error_code = v_reason, last_error_message = '上游结果待核实，已停止自动重试', updated_at = now() WHERE id = v_order.id;
        UPDATE public.tg_fulfillment_attempts SET status = 'unknown', error_code = 'worker_lease_expired', finished_at = now()
        WHERE order_id = v_order.id AND status IN ('started', 'submitted') AND finished_at IS NULL;
        INSERT INTO public.tg_audit_events(event_type, target_type, target_id, metadata)
        VALUES ('fulfillment_manual_review', 'purchase_order', v_purchase.id, jsonb_build_object('reason', v_reason));
        RETURN jsonb_build_object('success', false, 'code', 'manual_review', 'status', 'manual_review');
    END IF;
    UPDATE public.tg_fulfillment_attempts SET status = 'unknown', error_code = 'worker_lease_expired', finished_at = now()
    WHERE order_id = v_order.id AND status IN ('started', 'submitted') AND finished_at IS NULL;
    UPDATE public.tg_redemption_orders SET status = 'processing', lease_token = p_lease_token,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds), attempt_count = attempt_count + 1,
        last_attempt_at = now(), updated_at = now() WHERE id = v_order.id RETURNING * INTO v_order;
    INSERT INTO public.tg_fulfillment_attempts(order_id, attempt_no, status, provider_order_id, request_payload)
    VALUES (v_order.id, v_order.attempt_count, 'started', v_order.provider_order_id,
        jsonb_build_object('action', v_action, 'product_family', v_order.product_family, 'term_months', v_order.term_months,
            'stars_quantity', v_order.stars_quantity, 'payment_currency', v_order.provider_payment_currency, 'order_source', 'purchase'));
    INSERT INTO public.tg_audit_events(event_type, target_type, target_id, metadata)
    VALUES ('fulfillment_claimed', 'purchase_order', v_purchase.id,
        jsonb_build_object('action', v_action, 'attempt_no', v_order.attempt_count));
    RETURN jsonb_build_object('success', true, 'action', v_action, 'order', jsonb_build_object(
        'id', v_order.id, 'order_no', v_order.order_no, 'order_source', v_order.order_source, 'purchase_id', v_order.purchase_id,
        'status', v_order.status, 'telegram_username', v_order.telegram_username, 'product_family', v_order.product_family,
        'term_months', v_order.term_months, 'stars_quantity', v_order.stars_quantity, 'provider_order_id', v_order.provider_order_id,
        'provider_payment_currency', v_order.provider_payment_currency, 'provider_idempotency_key', v_order.provider_idempotency_key,
        'attempt_count', v_order.attempt_count, 'submitted_at', v_order.submitted_at,
        'lease_token', v_order.lease_token, 'lease_expires_at', v_order.lease_expires_at));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_finish_order(
    p_order_id UUID,
    p_lease_token UUID,
    p_state TEXT,
    p_provider_order_id TEXT DEFAULT NULL,
    p_provider_snapshot JSONB DEFAULT '{}'::JSONB,
    p_error_code TEXT DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL,
    p_next_attempt_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_code public.tg_redemption_codes%ROWTYPE;
    v_order public.tg_redemption_orders%ROWTYPE;
    v_code_id UUID;
    v_purchase public.tg_purchase_orders%ROWTYPE;
    v_purchase_id UUID;
    v_source TEXT;
    v_state TEXT := p_state;
    v_provider_id TEXT := nullif(trim(p_provider_order_id), '');
    v_error_code TEXT := left(p_error_code, 100);
    v_error_message TEXT := left(p_error_message, 500);
    v_snapshot JSONB;
    v_complete BOOLEAN;
BEGIN
    IF p_order_id IS NULL OR p_lease_token IS NULL
       OR p_state IS NULL OR p_state NOT IN ('processing', 'retry_waiting', 'succeeded', 'failed', 'manual_review')
       OR coalesce(jsonb_typeof(p_provider_snapshot), '') <> 'object'
       OR (v_provider_id IS NOT NULL AND char_length(v_provider_id) > 200) THEN
        RAISE EXCEPTION 'invalid TG worker result' USING ERRCODE = '22023';
    END IF;

    SELECT order_source, code_id, purchase_id INTO v_source, v_code_id, v_purchase_id
    FROM public.tg_redemption_orders WHERE id = p_order_id;
    IF v_source IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'not_found');
    END IF;
    -- Match the claim/callback lock order. Cash fulfillment never touches a
    -- redemption code or code-batch accounting.
    IF v_source = 'redemption' AND v_code_id IS NOT NULL AND v_purchase_id IS NULL THEN
        SELECT * INTO v_code FROM public.tg_redemption_codes WHERE id = v_code_id FOR UPDATE;
    ELSIF v_source = 'purchase' AND v_code_id IS NULL AND v_purchase_id IS NOT NULL THEN
        SELECT * INTO v_purchase FROM public.tg_purchase_orders WHERE id = v_purchase_id FOR UPDATE;
    ELSE
        RETURN jsonb_build_object('success', false, 'code', 'source_unconfirmed');
    END IF;
    SELECT * INTO v_order FROM public.tg_redemption_orders WHERE id = p_order_id FOR UPDATE;
    IF v_order.id IS NULL OR v_order.lease_token IS DISTINCT FROM p_lease_token OR v_order.status <> 'processing' THEN
        RETURN jsonb_build_object('success', false, 'code', 'lease_lost');
    END IF;

    -- Strip all unknown fields, even if a caller accidentally passes a raw
    -- provider response. Provider credentials and full request bodies stay out.
    SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::JSONB) INTO v_snapshot
    FROM jsonb_each(p_provider_snapshot) e
    WHERE e.key IN (
        'provider_order_id', 'provider_status', 'completed', 'telegram_username',
        'term_months', 'product_family', 'stars_quantity', 'product_type', 'idempotency_key_matches', 'method',
        'verified_by', 'amount', 'currency'
    );

    IF v_provider_id IS NULL THEN
        v_provider_id := v_order.provider_order_id;
    END IF;
    IF (v_order.provider_order_id IS NOT NULL AND v_provider_id IS DISTINCT FROM v_order.provider_order_id)
       OR (v_provider_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.tg_redemption_orders other
           WHERE other.provider = v_order.provider AND other.provider_order_id = v_provider_id
             AND other.id <> v_order.id
       )) THEN
        v_state := 'manual_review';
        v_provider_id := v_order.provider_order_id;
        v_error_code := 'provider_order_conflict';
        v_error_message := '上游订单归属待核实，已停止自动操作';
    END IF;

    IF v_state IN ('processing', 'retry_waiting') AND v_provider_id IS NULL THEN
        v_state := 'manual_review';
        v_error_code := 'provider_result_unknown';
        v_error_message := '上游结果待核实，已停止自动重试';
    END IF;

    IF v_order.provider_payment_currency IS NULL
       AND (v_order.submitted_at IS NOT NULL OR v_provider_id IS NOT NULL OR v_state = 'succeeded') THEN
        v_state := 'manual_review';
        v_error_code := 'provider_payment_currency_unconfirmed';
        v_error_message := '历史订单扣款币种未确认，等待人工核查';
    END IF;

    IF v_source = 'redemption' THEN
        IF v_code.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.tg_redemption_batches b
            WHERE b.id = v_code.batch_id AND b.product_family = v_order.product_family
              AND b.term_months IS NOT DISTINCT FROM v_order.term_months
              AND b.stars_quantity IS NOT DISTINCT FROM v_order.stars_quantity) THEN
            v_state := 'manual_review';
            v_error_code := 'entitlement_binding_conflict';
            v_error_message := '兑换权益归属待核实，已停止自动操作';
        END IF;
    ELSIF v_purchase.id IS NULL OR v_purchase.payment_status <> 'paid' OR v_purchase.paid_at IS NULL
        OR v_order.purchase_id IS DISTINCT FROM v_purchase.id OR v_order.code_id IS NOT NULL
        OR v_order.product_family IS DISTINCT FROM v_purchase.product_family
        OR v_order.term_months IS DISTINCT FROM v_purchase.term_months
        OR v_order.stars_quantity IS DISTINCT FROM v_purchase.stars_quantity
        OR v_order.telegram_username IS DISTINCT FROM v_purchase.telegram_username THEN
        v_state := 'manual_review';
        v_error_code := 'purchase_binding_conflict';
        v_error_message := '购买订单付款或权益归属待核实，已停止自动操作';
    END IF;

    IF v_state = 'succeeded' THEN
        -- A create response is never enough. Require the saved provider order
        -- plus an independently queried completed entitlement with exact binding.
        v_complete := v_order.provider_order_id IS NOT NULL
            AND v_order.submitted_at IS NOT NULL
            AND v_order.provider_payment_currency IN ('gram', 'usdt')
            -- Official SDK: USDT paymentCurrency is returned as Order.currency usd.
            AND v_snapshot->>'currency' = CASE v_order.provider_payment_currency
                WHEN 'gram' THEN 'gram' WHEN 'usdt' THEN 'usd' ELSE NULL END
            AND v_provider_id = v_order.provider_order_id
            AND v_snapshot->>'provider_order_id' = v_provider_id
            AND v_snapshot->'completed' = 'true'::JSONB
            AND v_snapshot->>'provider_status' = 'completed'
            AND v_snapshot->>'method' = 'api'
            AND v_snapshot->>'verified_by' = 'order_get'
            AND lower(regexp_replace(coalesce(v_snapshot->>'telegram_username', ''), '^@', '')) = v_order.telegram_username
            AND (
                (v_order.product_family = 'telegram_premium'
                    AND coalesce(v_snapshot->>'product_family', 'telegram_premium') = 'telegram_premium'
                    AND v_order.stars_quantity IS NULL
                    AND coalesce(v_snapshot->'stars_quantity', 'null'::JSONB) = 'null'::JSONB
                    AND v_snapshot->>'term_months' = v_order.term_months::TEXT
                    AND v_snapshot->>'product_type' = 'premium_' || v_order.term_months::TEXT || '_month')
                OR (v_order.product_family = 'telegram_stars'
                    AND v_snapshot->>'product_family' = 'telegram_stars'
                    AND v_order.term_months IS NULL
                    AND coalesce(v_snapshot->'term_months', 'null'::JSONB) = 'null'::JSONB
                    AND v_snapshot->>'stars_quantity' = v_order.stars_quantity::TEXT
                    AND jsonb_typeof(v_snapshot->'stars_quantity') = 'number'
                    AND v_snapshot->>'product_type' = 'stars')
            )
            AND coalesce(v_snapshot->'idempotency_key_matches', 'true'::JSONB) <> 'false'::JSONB;
        IF NOT coalesce(v_complete, false) THEN
            v_state := 'manual_review';
            v_error_code := 'provider_completion_unconfirmed';
            v_error_message := '上游完成状态或订单归属未确认';
        END IF;
    END IF;

    UPDATE public.tg_redemption_orders
    SET status = v_state, provider_order_id = v_provider_id, provider_response = v_snapshot,
        last_error_code = CASE WHEN v_state = 'succeeded' THEN NULL ELSE v_error_code END,
        last_error_message = CASE WHEN v_state = 'succeeded' THEN NULL ELSE v_error_message END,
        next_attempt_at = CASE WHEN v_state IN ('processing', 'retry_waiting')
            THEN greatest(coalesce(p_next_attempt_at, now() + interval '30 seconds'), now() + interval '1 second')
            ELSE next_attempt_at END,
        completed_at = CASE WHEN v_state = 'succeeded' THEN now() ELSE completed_at END,
        lease_token = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = v_order.id;

    UPDATE public.tg_fulfillment_attempts
    SET status = CASE WHEN v_state = 'succeeded' THEN 'succeeded'
                      WHEN v_state = 'failed' THEN 'failed'
                      WHEN v_state = 'manual_review' THEN 'unknown'
                      ELSE 'submitted' END,
        provider_order_id = v_provider_id, response_payload = v_snapshot,
        error_code = v_error_code, error_message = v_error_message, finished_at = now(),
        duration_ms = least(2147483647, greatest(0, floor(extract(epoch FROM (now() - started_at)) * 1000)))::INTEGER
    WHERE order_id = v_order.id AND attempt_no = v_order.attempt_count;

    IF v_source = 'redemption' THEN
        UPDATE public.tg_redemption_codes
        SET status = CASE WHEN v_state = 'succeeded' THEN 'fulfilled'
                          WHEN v_state = 'failed' THEN 'failed' ELSE 'fulfilling' END,
            fulfilled_at = CASE WHEN v_state = 'succeeded' THEN now() ELSE fulfilled_at END,
            redeemed_at = CASE WHEN v_state = 'succeeded' THEN now() ELSE redeemed_at END,
            reservation_expires_at = NULL, updated_at = now()
        WHERE id = v_order.code_id;

        IF v_state = 'succeeded' THEN
            UPDATE public.tg_redemption_batches
            SET redeemed_count = redeemed_count + 1, updated_at = now()
            WHERE id = v_code.batch_id;
        END IF;
    END IF;
    INSERT INTO public.tg_audit_events (event_type, target_type, target_id, metadata)
    VALUES ('fulfillment_result', 'redemption_order', v_order.id,
        jsonb_build_object('status', v_state, 'attempt_no', v_order.attempt_count,
            'order_source', v_source, 'purchase_id', v_order.purchase_id,
            'error_code', CASE WHEN v_state = 'succeeded' THEN NULL ELSE v_error_code END,
            'payment_currency', v_order.provider_payment_currency));
    RETURN jsonb_build_object('success', true, 'status', v_state,
        'product_family', v_order.product_family, 'term_months', v_order.term_months,
        'stars_quantity', v_order.stars_quantity);
END;
$$;

-- Administrative projection deliberately excludes hashes, lease tokens, raw
-- payment/provider payloads and the payment URL.
CREATE OR REPLACE VIEW public.tg_purchase_order_stats AS
SELECT p.id, p.order_no, p.product_key, p.telegram_username, p.product_family,
    p.term_months, p.stars_quantity, p.currency, p.total_minor, p.payment_channel,
    p.payment_status, coalesce(f.status, 'not_started') AS fulfillment_status,
    p.created_at, p.updated_at, p.payment_expires_at AS expires_at, p.price_version
FROM public.tg_purchase_orders p
LEFT JOIN public.tg_redemption_orders f ON f.purchase_id = p.id;

ALTER TABLE public.tg_purchase_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tg_purchase_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tg_purchase_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tg_purchase_products FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tg_purchase_quotes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tg_purchase_orders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.tg_purchase_order_stats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tg_purchase_products, public.tg_purchase_quotes, public.tg_purchase_orders TO service_role;
GRANT SELECT ON public.tg_purchase_order_stats TO service_role;

REVOKE ALL ON FUNCTION public.tg_guard_purchase_product() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_guard_purchase_identity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_guard_entitlement_identity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tg_update_price(TEXT, BIGINT, BIGINT, BOOLEAN, UUID, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_update_price(TEXT, BIGINT, BIGINT, BOOLEAN, UUID, BIGINT) TO service_role;
REVOKE ALL ON FUNCTION public.tg_purchase_order_json(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_purchase_order_json(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_purchase_quote(TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_purchase_quote(TEXT, INTEGER, INTEGER, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_create_purchase(UUID, TEXT, TEXT, BIGINT, BIGINT, BIGINT, CHAR(64), CHAR(64), TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_create_purchase(UUID, TEXT, TEXT, BIGINT, BIGINT, BIGINT, CHAR(64), CHAR(64), TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_claim_purchase_checkout(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_claim_purchase_checkout(UUID, UUID, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_save_purchase_checkout(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_save_purchase_checkout(UUID, UUID, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_fail_purchase_checkout(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_fail_purchase_checkout(UUID, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_confirm_purchase_payment(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_confirm_purchase_payment(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_purchase_status(TEXT, CHAR(64)) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_purchase_status(TEXT, CHAR(64)) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_claim_fulfillment_order(UUID, UUID, INTEGER, TEXT[], TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_claim_fulfillment_order(UUID, UUID, INTEGER, TEXT[], TEXT[]) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_finish_order(UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_finish_order(UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

-- Same-transaction structural verification. This block reads schema and
-- existing rows only; it never creates a quote, order, payment or delivery.
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
