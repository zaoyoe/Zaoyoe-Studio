-- Guest cash purchase foundation.
--
-- This migration deliberately does not change shop_orders, payment_orders, or
-- any points-purchase RPC. Guest purchases are an isolated cash-order domain.
-- The application must keep all writes to these tables behind service-role
-- server code/RPCs; anon and ordinary authenticated clients receive no table
-- grants or write policies.

DO $$
BEGIN
    IF to_regclass('public.shop_products') IS NULL THEN
        RAISE EXCEPTION 'guest shop migration requires public.shop_products';
    END IF;
    IF to_regclass('public.shop_product_skus') IS NULL THEN
        RAISE EXCEPTION 'guest shop migration requires public.shop_product_skus';
    END IF;
    IF to_regclass('public.shop_inventory') IS NULL THEN
        RAISE EXCEPTION 'guest shop migration requires public.shop_inventory';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'shop_inventory'
          AND column_name IN ('product_id', 'sku_id', 'status', 'is_shared')
        GROUP BY table_schema, table_name
        HAVING COUNT(*) = 4
    ) THEN
        RAISE EXCEPTION 'guest shop migration requires shop_inventory product_id, sku_id, status and is_shared columns';
    END IF;
END;
$$;

-- Product-level defaults. A SKU may override these values with the nullable
-- columns below. P0 still hard-rejects quantity greater than one in the API.
ALTER TABLE public.shop_products
    ADD COLUMN IF NOT EXISTS allow_guest_purchase BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS guest_cash_price_cny NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS guest_cash_price_intl NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS guest_max_quantity INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS guest_payment_channels JSONB NOT NULL DEFAULT '[]'::JSONB;

ALTER TABLE public.shop_products
    DROP CONSTRAINT IF EXISTS shop_products_guest_cash_price_cny_check,
    DROP CONSTRAINT IF EXISTS shop_products_guest_cash_price_intl_check,
    DROP CONSTRAINT IF EXISTS shop_products_guest_max_quantity_check,
    DROP CONSTRAINT IF EXISTS shop_products_guest_payment_channels_check;

ALTER TABLE public.shop_products
    ADD CONSTRAINT shop_products_guest_cash_price_cny_check
        CHECK (guest_cash_price_cny IS NULL OR guest_cash_price_cny > 0),
    ADD CONSTRAINT shop_products_guest_cash_price_intl_check
        CHECK (guest_cash_price_intl IS NULL OR guest_cash_price_intl > 0),
    ADD CONSTRAINT shop_products_guest_max_quantity_check
        CHECK (guest_max_quantity >= 1 AND guest_max_quantity <= 99),
    ADD CONSTRAINT shop_products_guest_payment_channels_check
        CHECK (jsonb_typeof(guest_payment_channels) = 'array');

ALTER TABLE public.shop_product_skus
    ADD COLUMN IF NOT EXISTS allow_guest_purchase BOOLEAN,
    ADD COLUMN IF NOT EXISTS guest_cash_price_cny NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS guest_cash_price_intl NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS guest_max_quantity INTEGER,
    ADD COLUMN IF NOT EXISTS guest_payment_channels JSONB;

ALTER TABLE public.shop_product_skus
    DROP CONSTRAINT IF EXISTS shop_product_skus_guest_cash_price_cny_check,
    DROP CONSTRAINT IF EXISTS shop_product_skus_guest_cash_price_intl_check,
    DROP CONSTRAINT IF EXISTS shop_product_skus_guest_max_quantity_check,
    DROP CONSTRAINT IF EXISTS shop_product_skus_guest_payment_channels_check;

ALTER TABLE public.shop_product_skus
    ADD CONSTRAINT shop_product_skus_guest_cash_price_cny_check
        CHECK (guest_cash_price_cny IS NULL OR guest_cash_price_cny > 0),
    ADD CONSTRAINT shop_product_skus_guest_cash_price_intl_check
        CHECK (guest_cash_price_intl IS NULL OR guest_cash_price_intl > 0),
    ADD CONSTRAINT shop_product_skus_guest_max_quantity_check
        CHECK (guest_max_quantity IS NULL OR (guest_max_quantity >= 1 AND guest_max_quantity <= 99)),
    ADD CONSTRAINT shop_product_skus_guest_payment_channels_check
        CHECK (guest_payment_channels IS NULL OR jsonb_typeof(guest_payment_channels) = 'array');

-- These composite keys allow the guest-order foreign keys below to enforce
-- product/SKU ownership without changing the existing primary keys.
CREATE UNIQUE INDEX IF NOT EXISTS ux_shop_product_skus_product_id_id
    ON public.shop_product_skus(product_id, id);

COMMENT ON COLUMN public.shop_products.allow_guest_purchase IS
    'Enables the isolated guest cash channel. Defaults false and is never a payment result.';
COMMENT ON COLUMN public.shop_products.guest_cash_price_cny IS
    'Guest cash unit price for the CN site, stored in CNY. NULL means unavailable.';
COMMENT ON COLUMN public.shop_products.guest_cash_price_intl IS
    'Guest cash unit price for the INTL site, stored in USD. NULL means unavailable.';
COMMENT ON COLUMN public.shop_products.guest_max_quantity IS
    'Configured guest quantity ceiling. P0 API additionally allows only quantity 1.';
COMMENT ON COLUMN public.shop_products.guest_payment_channels IS
    'JSON array of provider channel identifiers allowed for guest cash checkout.';
COMMENT ON COLUMN public.shop_product_skus.allow_guest_purchase IS
    'Nullable SKU override for the product guest-purchase switch.';
COMMENT ON COLUMN public.shop_product_skus.guest_cash_price_cny IS
    'Nullable SKU override for the CN guest cash unit price in CNY.';
COMMENT ON COLUMN public.shop_product_skus.guest_cash_price_intl IS
    'Nullable SKU override for the INTL guest cash unit price in USD.';
COMMENT ON COLUMN public.shop_product_skus.guest_max_quantity IS
    'Nullable SKU override for the guest quantity ceiling.';
COMMENT ON COLUMN public.shop_product_skus.guest_payment_channels IS
    'Nullable SKU override for the allowed guest payment channel array.';

CREATE TABLE IF NOT EXISTS public.guest_shop_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_no TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    source_channel TEXT NOT NULL DEFAULT 'website_guest',
    site VARCHAR(10) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    product_id UUID NOT NULL REFERENCES public.shop_products(id) ON DELETE RESTRICT,
    sku_id UUID NOT NULL,
    snapshot_product_name TEXT NOT NULL,
    snapshot_sku_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_amount NUMERIC(14,2) NOT NULL,
    total_amount NUMERIC(14,2) NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'pending',
    reservation_status TEXT NOT NULL DEFAULT 'none',
    fulfillment_status TEXT NOT NULL DEFAULT 'pending',
    refund_status TEXT NOT NULL DEFAULT 'none',
    claim_secret_hash TEXT NOT NULL,
    claim_secret_version SMALLINT NOT NULL DEFAULT 1,
    claim_attempt_count INTEGER NOT NULL DEFAULT 0,
    buyer_contact_hash TEXT,
    request_ip_hash TEXT,
    request_device_hash TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ,
    fulfilled_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    last_error_code TEXT,
    last_error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT guest_shop_orders_idempotency_key_check
        CHECK (char_length(idempotency_key) BETWEEN 16 AND 200),
    CONSTRAINT guest_shop_orders_source_channel_check
        CHECK (source_channel = 'website_guest'),
    CONSTRAINT guest_shop_orders_site_check
        CHECK (site IN ('cn', 'intl')),
    CONSTRAINT guest_shop_orders_currency_check
        CHECK (currency IN ('CNY', 'USD')),
    CONSTRAINT guest_shop_orders_site_currency_check
        CHECK ((site = 'cn' AND currency = 'CNY') OR (site = 'intl' AND currency = 'USD')),
    CONSTRAINT guest_shop_orders_quantity_check
        CHECK (quantity >= 1 AND quantity <= 99),
    CONSTRAINT guest_shop_orders_amount_check
        CHECK (unit_amount > 0 AND total_amount > 0 AND total_amount = unit_amount * quantity),
    CONSTRAINT guest_shop_orders_payment_status_check
        CHECK (payment_status IN ('pending', 'created', 'confirmed', 'partial', 'overpaid', 'amount_mismatch', 'expired', 'refunded', 'chargeback', 'review', 'failed')),
    CONSTRAINT guest_shop_orders_reservation_status_check
        CHECK (reservation_status IN ('none', 'held', 'released', 'consumed')),
    CONSTRAINT guest_shop_orders_fulfillment_status_check
        CHECK (fulfillment_status IN ('pending', 'fulfilling', 'delivered', 'failed', 'dead_letter', 'paid_unfulfillable', 'refunded')),
    CONSTRAINT guest_shop_orders_refund_status_check
        CHECK (refund_status IN ('none', 'pending', 'succeeded', 'failed', 'manual_review')),
    CONSTRAINT guest_shop_orders_claim_secret_hash_check
        CHECK (char_length(claim_secret_hash) >= 32),
    CONSTRAINT guest_shop_orders_expiry_check
        CHECK (expires_at > created_at),
    CONSTRAINT guest_shop_orders_delivered_at_check
        CHECK (fulfilled_at IS NULL OR fulfillment_status = 'delivered')
    ,CONSTRAINT guest_shop_orders_sku_product_fk
        FOREIGN KEY (product_id, sku_id)
        REFERENCES public.shop_product_skus(product_id, id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_guest_shop_orders_site_idempotency
    ON public.guest_shop_orders(site, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_guest_shop_orders_status_expiry
    ON public.guest_shop_orders(payment_status, reservation_status, expires_at);
CREATE INDEX IF NOT EXISTS idx_guest_shop_orders_fulfillment
    ON public.guest_shop_orders(fulfillment_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_guest_shop_orders_product_created
    ON public.guest_shop_orders(site, product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.guest_shop_inventory_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL UNIQUE REFERENCES public.guest_shop_orders(id) ON DELETE RESTRICT,
    inventory_id UUID NOT NULL REFERENCES public.shop_inventory(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES public.shop_products(id) ON DELETE RESTRICT,
    sku_id UUID NOT NULL REFERENCES public.shop_product_skus(id) ON DELETE RESTRICT,
    site VARCHAR(10) NOT NULL,
    status TEXT NOT NULL DEFAULT 'held',
    reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reserved_until TIMESTAMPTZ NOT NULL,
    released_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    release_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT guest_shop_inventory_reservations_site_check
        CHECK (site IN ('cn', 'intl')),
    CONSTRAINT guest_shop_inventory_reservations_status_check
        CHECK (status IN ('held', 'released', 'consumed')),
    CONSTRAINT guest_shop_inventory_reservations_expiry_check
        CHECK (reserved_until > reserved_at),
    CONSTRAINT guest_shop_inventory_reservations_release_fields_check
        CHECK ((status = 'released' AND released_at IS NOT NULL) OR status <> 'released'),
    CONSTRAINT guest_shop_inventory_reservations_consumed_fields_check
        CHECK ((status = 'consumed' AND consumed_at IS NOT NULL) OR status <> 'consumed')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_guest_shop_inventory_active_reservation
    ON public.guest_shop_inventory_reservations(inventory_id)
    WHERE status IN ('held', 'consumed');
CREATE INDEX IF NOT EXISTS idx_guest_shop_inventory_reservations_expiry
    ON public.guest_shop_inventory_reservations(status, reserved_until);
CREATE INDEX IF NOT EXISTS idx_guest_shop_inventory_reservations_order
    ON public.guest_shop_inventory_reservations(order_id);

CREATE TABLE IF NOT EXISTS public.guest_shop_payment_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    guest_order_id UUID NOT NULL UNIQUE REFERENCES public.guest_shop_orders(id) ON DELETE RESTRICT,
    merchant_order_no TEXT NOT NULL UNIQUE,
    purpose TEXT NOT NULL DEFAULT 'shop_direct',
    provider TEXT NOT NULL,
    channel TEXT NOT NULL,
    provider_order_no TEXT,
    site VARCHAR(10) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    expected_amount NUMERIC(14,2) NOT NULL,
    paid_amount NUMERIC(14,2),
    payment_fee NUMERIC(14,2),
    status TEXT NOT NULL DEFAULT 'pending',
    sign_verified BOOLEAN NOT NULL DEFAULT false,
    amount_verified BOOLEAN NOT NULL DEFAULT false,
    currency_verified BOOLEAN NOT NULL DEFAULT false,
    final_status_verified BOOLEAN NOT NULL DEFAULT false,
    provider_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    checkout_reference TEXT,
    last_event_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    last_error_code TEXT,
    last_error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT guest_shop_payment_orders_purpose_check
        CHECK (purpose = 'shop_direct'),
    CONSTRAINT guest_shop_payment_orders_site_check
        CHECK (site IN ('cn', 'intl')),
    CONSTRAINT guest_shop_payment_orders_currency_check
        CHECK (currency IN ('CNY', 'USD')),
    CONSTRAINT guest_shop_payment_orders_site_currency_check
        CHECK ((site = 'cn' AND currency = 'CNY') OR (site = 'intl' AND currency = 'USD')),
    CONSTRAINT guest_shop_payment_orders_expected_amount_check
        CHECK (expected_amount > 0),
    CONSTRAINT guest_shop_payment_orders_paid_amount_check
        CHECK (paid_amount IS NULL OR paid_amount >= 0),
    CONSTRAINT guest_shop_payment_orders_fee_check
        CHECK (payment_fee IS NULL OR payment_fee >= 0),
    CONSTRAINT guest_shop_payment_orders_status_check
        CHECK (status IN ('pending', 'created', 'confirmed', 'partial', 'overpaid', 'amount_mismatch', 'expired', 'refunded', 'chargeback', 'review', 'failed')),
    CONSTRAINT guest_shop_payment_orders_expiry_check
        CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_guest_shop_payment_provider_order
    ON public.guest_shop_payment_orders(provider, provider_order_no)
    WHERE provider_order_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guest_shop_payment_orders_status_expiry
    ON public.guest_shop_payment_orders(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_guest_shop_payment_orders_provider_created
    ON public.guest_shop_payment_orders(provider, created_at DESC);

CREATE TABLE IF NOT EXISTS public.guest_shop_payment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_order_id UUID REFERENCES public.guest_shop_payment_orders(id) ON DELETE RESTRICT,
    merchant_order_no TEXT,
    provider TEXT NOT NULL,
    event_key TEXT NOT NULL,
    provider_event_id TEXT,
    provider_order_no TEXT,
    event_type TEXT NOT NULL,
    observed_status TEXT,
    payload_redacted JSONB NOT NULL DEFAULT '{}'::JSONB,
    body_sha256 TEXT NOT NULL,
    signature_version TEXT,
    signature_verified BOOLEAN NOT NULL DEFAULT false,
    amount_verified BOOLEAN NOT NULL DEFAULT false,
    currency_verified BOOLEAN NOT NULL DEFAULT false,
    final_status_verified BOOLEAN NOT NULL DEFAULT false,
    processing_status TEXT NOT NULL DEFAULT 'received',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT guest_shop_payment_events_processing_status_check
        CHECK (processing_status IN ('received', 'verified', 'rejected', 'processed', 'duplicate', 'retry', 'dead_letter')),
    CONSTRAINT guest_shop_payment_events_attempt_count_check
        CHECK (attempt_count >= 0),
    CONSTRAINT guest_shop_payment_events_body_sha256_check
        CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT guest_shop_payment_events_event_key_check
        CHECK (char_length(btrim(event_key)) BETWEEN 1 AND 300),
    CONSTRAINT guest_shop_payment_events_reference_check
        CHECK (payment_order_id IS NOT NULL OR NULLIF(btrim(merchant_order_no), '') IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_guest_shop_payment_events_provider_key
    ON public.guest_shop_payment_events(provider, event_key);
CREATE INDEX IF NOT EXISTS idx_guest_shop_payment_events_payment_order
    ON public.guest_shop_payment_events(payment_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guest_shop_payment_events_merchant_order
    ON public.guest_shop_payment_events(merchant_order_no, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guest_shop_payment_events_processing
    ON public.guest_shop_payment_events(processing_status, received_at);

COMMENT ON TABLE public.guest_shop_orders IS
    'Independent cash checkout orders for unauthenticated storefront buyers. Never enters points purchase/refund RPCs.';
COMMENT ON TABLE public.guest_shop_inventory_reservations IS
    'One-row reservation ledger for non-shared inventory; active unique index prevents double consumption.';
COMMENT ON TABLE public.guest_shop_payment_orders IS
    'Payment intents whose immutable purpose is shop_direct; recharge code must reject this domain.';
COMMENT ON TABLE public.guest_shop_payment_events IS
    'Idempotent, redacted webhook audit events. The exact raw body is hashed, not persisted in plaintext.';
COMMENT ON COLUMN public.guest_shop_payment_orders.checkout_reference IS
    'Provider checkout reference only; never put card content, claim secrets, or inventory content here.';
COMMENT ON COLUMN public.guest_shop_payment_events.payload_redacted IS
    'Provider payload after adapter redaction. Do not store card data, claim secrets, or inventory content.';

-- Validate cross-table snapshots at the database boundary. The API performs
-- the same checks before writing; these triggers protect against future
-- endpoints accidentally swapping a product, SKU, inventory row or amount.
CREATE OR REPLACE FUNCTION public.guest_shop_validate_inventory_reservation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    v_inventory RECORD;
BEGIN
    SELECT * INTO v_order
    FROM public.guest_shop_orders
    WHERE id = NEW.order_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest reservation references missing order';
    END IF;
    IF NEW.product_id IS DISTINCT FROM v_order.product_id
       OR NEW.sku_id IS DISTINCT FROM v_order.sku_id
       OR NEW.site <> v_order.site THEN
        RAISE EXCEPTION 'guest reservation does not match order snapshot';
    END IF;

    SELECT product_id, sku_id, status, COALESCE(is_shared, false) AS is_shared
    INTO v_inventory
    FROM public.shop_inventory
    WHERE id = NEW.inventory_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest reservation references missing inventory';
    END IF;
    IF v_inventory.product_id IS DISTINCT FROM v_order.product_id
       OR (v_inventory.sku_id IS NOT NULL AND v_inventory.sku_id <> v_order.sku_id)
       OR v_inventory.is_shared THEN
        RAISE EXCEPTION 'guest reservation inventory does not match a non-shared order SKU';
    END IF;
    IF NEW.status = 'held' AND v_inventory.status NOT IN ('available', 'reserve') THEN
        RAISE EXCEPTION 'guest reservation inventory is not reservable';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guest_shop_validate_inventory_reservation
    ON public.guest_shop_inventory_reservations;
CREATE TRIGGER trg_guest_shop_validate_inventory_reservation
    BEFORE INSERT OR UPDATE OF order_id, inventory_id, product_id, sku_id, site, status
    ON public.guest_shop_inventory_reservations
    FOR EACH ROW
    EXECUTE FUNCTION public.guest_shop_validate_inventory_reservation();

CREATE OR REPLACE FUNCTION public.guest_shop_validate_payment_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
BEGIN
    SELECT * INTO v_order
    FROM public.guest_shop_orders
    WHERE id = NEW.guest_order_id
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest payment references missing order';
    END IF;
    IF NEW.merchant_order_no <> v_order.order_no
       OR NEW.site <> v_order.site
       OR NEW.currency <> v_order.currency
       OR NEW.expected_amount <> v_order.total_amount THEN
        RAISE EXCEPTION 'guest payment snapshot does not match order';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guest_shop_validate_payment_order
    ON public.guest_shop_payment_orders;
CREATE TRIGGER trg_guest_shop_validate_payment_order
    BEFORE INSERT OR UPDATE OF guest_order_id, site, currency, expected_amount
    ON public.guest_shop_payment_orders
    FOR EACH ROW
    EXECUTE FUNCTION public.guest_shop_validate_payment_order();

CREATE OR REPLACE FUNCTION public.guest_shop_validate_payment_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_payment public.guest_shop_payment_orders%ROWTYPE;
BEGIN
    IF NEW.payment_order_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_payment
    FROM public.guest_shop_payment_orders
    WHERE id = NEW.payment_order_id
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest payment event references missing payment order';
    END IF;
    IF NEW.provider <> v_payment.provider
       OR (NEW.provider_order_no IS NOT NULL
           AND v_payment.provider_order_no IS NOT NULL
           AND NEW.provider_order_no <> v_payment.provider_order_no)
       OR (NEW.merchant_order_no IS NOT NULL
           AND NEW.merchant_order_no <> v_payment.merchant_order_no) THEN
        RAISE EXCEPTION 'guest payment event does not match payment order';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guest_shop_validate_payment_event
    ON public.guest_shop_payment_events;
CREATE TRIGGER trg_guest_shop_validate_payment_event
    BEFORE INSERT OR UPDATE OF payment_order_id, merchant_order_no, provider, provider_order_no
    ON public.guest_shop_payment_events
    FOR EACH ROW
    EXECUTE FUNCTION public.guest_shop_validate_payment_event();

ALTER TABLE public.guest_shop_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_shop_inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_shop_payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_shop_payment_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.guest_shop_orders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guest_shop_inventory_reservations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guest_shop_payment_orders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guest_shop_payment_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.guest_shop_orders TO service_role;
GRANT ALL ON TABLE public.guest_shop_inventory_reservations TO service_role;
GRANT ALL ON TABLE public.guest_shop_payment_orders TO service_role;
GRANT ALL ON TABLE public.guest_shop_payment_events TO service_role;
-- The admin view below uses security_invoker=on, so authenticated operators
-- need SELECT privilege here; the RLS policies immediately below restrict it
-- to public.is_admin() and service_role remains the only writer.
GRANT SELECT ON TABLE public.guest_shop_orders TO authenticated;
GRANT SELECT ON TABLE public.guest_shop_inventory_reservations TO authenticated;
GRANT SELECT ON TABLE public.guest_shop_payment_orders TO authenticated;
GRANT SELECT ON TABLE public.guest_shop_payment_events TO authenticated;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'guest_shop_orders' AND policyname = 'Admins view guest shop orders') THEN
        CREATE POLICY "Admins view guest shop orders"
            ON public.guest_shop_orders FOR SELECT TO authenticated
            USING (public.is_admin());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'guest_shop_inventory_reservations' AND policyname = 'Admins view guest inventory reservations') THEN
        CREATE POLICY "Admins view guest inventory reservations"
            ON public.guest_shop_inventory_reservations FOR SELECT TO authenticated
            USING (public.is_admin());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'guest_shop_payment_orders' AND policyname = 'Admins view guest payment orders') THEN
        CREATE POLICY "Admins view guest payment orders"
            ON public.guest_shop_payment_orders FOR SELECT TO authenticated
            USING (public.is_admin());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'guest_shop_payment_events' AND policyname = 'Admins view guest payment events') THEN
        CREATE POLICY "Admins view guest payment events"
            ON public.guest_shop_payment_events FOR SELECT TO authenticated
            USING (public.is_admin());
    END IF;
END;
$$;

CREATE OR REPLACE VIEW public.admin_guest_shop_orders
WITH (security_invoker = on) AS
SELECT
    o.id,
    o.order_no,
    o.site,
    o.currency,
    o.product_id,
    o.sku_id,
    o.snapshot_product_name,
    o.snapshot_sku_name,
    o.quantity,
    o.unit_amount,
    o.total_amount,
    o.payment_status,
    o.reservation_status,
    o.fulfillment_status,
    o.refund_status,
    o.expires_at,
    o.paid_at,
    o.fulfilled_at,
    o.last_error_code,
    o.last_error_message,
    r.id AS reservation_id,
    r.inventory_id,
    r.status AS reservation_row_status,
    r.reserved_until,
    p.id AS payment_order_id,
    p.provider,
    p.channel,
    p.provider_order_no,
    p.status AS payment_row_status,
    p.expected_amount,
    p.paid_amount,
    p.sign_verified,
    p.amount_verified,
    p.currency_verified,
    p.final_status_verified,
    p.last_event_at,
    p.last_error_code AS payment_last_error_code,
    p.last_error_message AS payment_last_error_message,
    o.created_at,
    o.updated_at
FROM public.guest_shop_orders o
LEFT JOIN public.guest_shop_inventory_reservations r ON r.order_id = o.id
LEFT JOIN public.guest_shop_payment_orders p ON p.guest_order_id = o.id
WHERE COALESCE(auth.role(), '') = 'service_role'
   OR public.is_admin();

REVOKE ALL ON public.admin_guest_shop_orders FROM PUBLIC, anon;
GRANT SELECT ON public.admin_guest_shop_orders TO authenticated, service_role;

COMMENT ON VIEW public.admin_guest_shop_orders IS
    'Admin-only, content-free guest order view. It intentionally excludes claim hashes and inventory content.';
