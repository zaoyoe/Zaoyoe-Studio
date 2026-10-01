-- Guest cart checkout batches.
--
-- This is an isolated domain. Existing guest_shop_orders and its one-order /
-- one-payment contract remain unchanged for direct product checkout. A batch
-- owns one payment and contains immutable product/SKU snapshots plus one
-- reservation ledger per inventory item. The create RPC deliberately performs
-- pricing and reservation in one transaction: any missing SKU stock aborts the
-- whole batch before a payment intent can be created.

CREATE TABLE IF NOT EXISTS public.guest_shop_checkout_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_no TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    site VARCHAR(10) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    provider TEXT NOT NULL,
    channel TEXT NOT NULL,
    total_amount NUMERIC(14,2) NOT NULL,
    payment_status TEXT NOT NULL DEFAULT 'pending',
    fulfillment_status TEXT NOT NULL DEFAULT 'pending',
    refund_status TEXT NOT NULL DEFAULT 'none',
    claim_secret_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ,
    fulfilled_at TIMESTAMPTZ,
    last_error_code TEXT,
    last_error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT guest_shop_checkout_batches_idempotency_check CHECK (char_length(idempotency_key) BETWEEN 16 AND 200),
    CONSTRAINT guest_shop_checkout_batches_fingerprint_check CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT guest_shop_checkout_batches_site_check CHECK (site IN ('cn', 'intl')),
    CONSTRAINT guest_shop_checkout_batches_currency_check CHECK ((site = 'cn' AND currency = 'CNY') OR (site = 'intl' AND currency = 'USD')),
    -- The create RPC inserts a pending shell before it has calculated every
    -- item.  Pending is the only state allowed to carry the temporary zero;
    -- the payment row is created only after the final positive total is set.
    CONSTRAINT guest_shop_checkout_batches_amount_check CHECK (total_amount > 0 OR payment_status = 'pending'),
    CONSTRAINT guest_shop_checkout_batches_payment_check CHECK (payment_status IN ('pending', 'created', 'confirmed', 'expired', 'refunded', 'chargeback', 'review', 'failed')),
    CONSTRAINT guest_shop_checkout_batches_fulfillment_check CHECK (fulfillment_status IN ('pending', 'fulfilling', 'delivered', 'failed', 'dead_letter', 'paid_unfulfillable', 'refunded')),
    CONSTRAINT guest_shop_checkout_batches_refund_check CHECK (refund_status IN ('none', 'pending', 'succeeded', 'failed', 'manual_review')),
    CONSTRAINT guest_shop_checkout_batches_claim_check CHECK (char_length(claim_secret_hash) >= 32),
    CONSTRAINT guest_shop_checkout_batches_expiry_check CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_guest_shop_checkout_batches_idempotency
    ON public.guest_shop_checkout_batches(site, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_guest_shop_checkout_batches_payment
    ON public.guest_shop_checkout_batches(payment_status, expires_at);
CREATE INDEX IF NOT EXISTS idx_guest_shop_checkout_batches_fulfillment
    ON public.guest_shop_checkout_batches(fulfillment_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.guest_shop_checkout_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES public.guest_shop_checkout_batches(id) ON DELETE RESTRICT,
    item_index INTEGER NOT NULL,
    product_id UUID NOT NULL REFERENCES public.shop_products(id) ON DELETE RESTRICT,
    sku_id UUID NOT NULL,
    snapshot_product_name TEXT NOT NULL,
    snapshot_sku_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_amount NUMERIC(14,2) NOT NULL,
    total_amount NUMERIC(14,2) NOT NULL,
    fulfillment_status TEXT NOT NULL DEFAULT 'pending',
    delivered_at TIMESTAMPTZ,
    last_error_code TEXT,
    last_error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT guest_shop_checkout_items_index_check CHECK (item_index >= 0),
    CONSTRAINT guest_shop_checkout_items_quantity_check CHECK (quantity BETWEEN 1 AND 99),
    CONSTRAINT guest_shop_checkout_items_amount_check CHECK (unit_amount > 0 AND total_amount = unit_amount * quantity),
    CONSTRAINT guest_shop_checkout_items_status_check CHECK (fulfillment_status IN ('pending', 'fulfilling', 'delivered', 'failed', 'paid_unfulfillable')),
    CONSTRAINT guest_shop_checkout_items_sku_product_fk FOREIGN KEY (product_id, sku_id)
        REFERENCES public.shop_product_skus(product_id, id) ON DELETE RESTRICT,
    CONSTRAINT guest_shop_checkout_items_batch_index_unique UNIQUE (batch_id, item_index)
);
CREATE INDEX IF NOT EXISTS idx_guest_shop_checkout_items_batch ON public.guest_shop_checkout_items(batch_id, item_index);

CREATE TABLE IF NOT EXISTS public.guest_shop_checkout_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES public.guest_shop_checkout_batches(id) ON DELETE RESTRICT,
    item_id UUID NOT NULL REFERENCES public.guest_shop_checkout_items(id) ON DELETE RESTRICT,
    inventory_id UUID NOT NULL REFERENCES public.shop_inventory(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES public.shop_products(id) ON DELETE RESTRICT,
    sku_id UUID NOT NULL REFERENCES public.shop_product_skus(id) ON DELETE RESTRICT,
    site VARCHAR(10) NOT NULL,
    status TEXT NOT NULL DEFAULT 'held',
    reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reserved_until TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    release_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT guest_shop_checkout_reservations_status_check CHECK (status IN ('held', 'consumed', 'released')),
    CONSTRAINT guest_shop_checkout_reservations_site_check CHECK (site IN ('cn', 'intl')),
    CONSTRAINT guest_shop_checkout_reservations_expiry_check CHECK (reserved_until > reserved_at),
    CONSTRAINT guest_shop_checkout_reservations_consumed_check CHECK ((status = 'consumed' AND consumed_at IS NOT NULL) OR status <> 'consumed'),
    CONSTRAINT guest_shop_checkout_reservations_released_check CHECK ((status = 'released' AND released_at IS NOT NULL) OR status <> 'released')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_guest_shop_checkout_reservations_active
    ON public.guest_shop_checkout_reservations(inventory_id) WHERE status IN ('held', 'consumed');
CREATE INDEX IF NOT EXISTS idx_guest_shop_checkout_reservations_batch ON public.guest_shop_checkout_reservations(batch_id, status);

CREATE TABLE IF NOT EXISTS public.guest_shop_checkout_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL UNIQUE REFERENCES public.guest_shop_checkout_batches(id) ON DELETE RESTRICT,
    merchant_order_no TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    channel TEXT NOT NULL,
    provider_order_no TEXT,
    site VARCHAR(10) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    expected_amount NUMERIC(14,2) NOT NULL,
    paid_amount NUMERIC(14,2),
    status TEXT NOT NULL DEFAULT 'pending',
    provider_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    checkout_reference TEXT,
    last_event_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    last_error_code TEXT,
    last_error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT guest_shop_checkout_payments_status_check CHECK (status IN ('pending', 'created', 'confirmed', 'expired', 'refunded', 'chargeback', 'review', 'failed')),
    CONSTRAINT guest_shop_checkout_payments_amount_check CHECK (expected_amount > 0 AND (paid_amount IS NULL OR paid_amount >= 0)),
    CONSTRAINT guest_shop_checkout_payments_site_currency_check CHECK ((site = 'cn' AND currency = 'CNY') OR (site = 'intl' AND currency = 'USD'))
);
CREATE INDEX IF NOT EXISTS idx_guest_shop_checkout_payments_provider_ref
    ON public.guest_shop_checkout_payments(provider, provider_order_no);
-- A provider reference may belong to only one batch payment. The webhook
-- lookup can still use the non-unique compatibility index above, while this
-- partial unique index prevents the same provider order from being rebound to
-- another batch during a retry or concurrent callback.
CREATE UNIQUE INDEX IF NOT EXISTS ux_guest_shop_checkout_payments_provider_ref
    ON public.guest_shop_checkout_payments(provider, provider_order_no)
    WHERE provider_order_no IS NOT NULL;

ALTER TABLE public.guest_shop_checkout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_shop_checkout_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_shop_checkout_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_shop_checkout_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guest_shop_checkout_batches, public.guest_shop_checkout_items,
    public.guest_shop_checkout_reservations, public.guest_shop_checkout_payments
    FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_guest_shop_create_checkout_batch(
    p_site TEXT,
    p_items JSONB,
    p_idempotency_key TEXT,
    p_request_fingerprint TEXT,
    p_claim_secret_hash TEXT,
    p_provider TEXT,
    p_channel TEXT,
    p_ttl_seconds INTEGER DEFAULT 1800
)
RETURNS TABLE (
    batch_id UUID,
    batch_no TEXT,
    payment_id UUID,
    merchant_order_no TEXT,
    site TEXT,
    currency TEXT,
    total_amount NUMERIC,
    expires_at TIMESTAMPTZ,
    payment_status TEXT,
    items JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_site TEXT := LOWER(BTRIM(COALESCE(p_site, '')));
    v_currency TEXT := CASE WHEN LOWER(BTRIM(COALESCE(p_site, ''))) = 'intl' THEN 'USD' ELSE 'CNY' END;
    v_provider TEXT := LOWER(BTRIM(COALESCE(p_provider, '')));
    v_channel TEXT := LOWER(BTRIM(COALESCE(p_channel, '')));
    v_key TEXT := BTRIM(COALESCE(p_idempotency_key, ''));
    v_batch_id UUID;
    v_batch_no TEXT;
    v_payment_id UUID;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_expires TIMESTAMPTZ;
    v_total NUMERIC(14,2) := 0;
    v_item JSONB;
    v_item_row RECORD;
    v_product public.shop_products%ROWTYPE;
    v_sku public.shop_product_skus%ROWTYPE;
    v_product_id UUID;
    v_sku_id UUID;
    v_quantity INTEGER;
    v_unit NUMERIC(14,2);
    v_item_total NUMERIC(14,2);
    v_index INTEGER := 0;
    v_item_id UUID;
    v_inventory RECORD;
    v_source_sku_id UUID;
    v_reserved INTEGER;
    v_requested INTEGER;
    v_existing RECORD;
    v_allowed JSONB;
    v_items JSONB := '[]'::JSONB;
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF v_site NOT IN ('cn', 'intl') OR v_key !~ '^.{16,200}$' OR p_items IS NULL
       OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0
       OR jsonb_array_length(p_items) > 50 THEN
        RAISE EXCEPTION 'guest_checkout_batch_invalid';
    END IF;
    IF p_request_fingerprint !~ '^[0-9a-f]{64}$' OR p_claim_secret_hash !~ '^hmac-sha256:v1:[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'guest_checkout_batch_invalid';
    END IF;
    IF v_provider = '' OR v_channel = '' OR v_provider IN ('mock', 'test', 'fake') OR v_channel IN ('mock', 'test', 'fake') THEN
        RAISE EXCEPTION 'guest_invalid_payment_provider';
    END IF;
    IF p_ttl_seconds IS NULL OR p_ttl_seconds < 300 OR p_ttl_seconds > 7200 THEN
        RAISE EXCEPTION 'guest_invalid_order_ttl';
    END IF;
    v_expires := v_now + make_interval(secs => p_ttl_seconds);
    PERFORM pg_advisory_xact_lock(hashtextextended(v_site || ':cart:' || v_key, 0));

    -- Lock all requested product/SKU keys in a deterministic order before
    -- touching product, SKU, or inventory rows. This prevents two carts with
    -- the same items in a different visual order from deadlocking each other.
    FOR v_item IN
        SELECT value
        FROM jsonb_array_elements(p_items)
        ORDER BY value->>'productId', value->>'skuId'
    LOOP
        IF NULLIF(v_item->>'productId', '') IS NULL OR NULLIF(v_item->>'skuId', '') IS NULL THEN
            RAISE EXCEPTION 'guest_checkout_batch_invalid_item';
        END IF;
        PERFORM pg_advisory_xact_lock(hashtextextended(
            v_site || ':sku:' || (v_item->>'productId') || ':' || (v_item->>'skuId'), 0));
    END LOOP;

    SELECT b.*, p.id AS existing_payment_id, p.merchant_order_no AS existing_merchant_no
      INTO v_existing
      FROM public.guest_shop_checkout_batches b
      LEFT JOIN public.guest_shop_checkout_payments p ON p.batch_id = b.id
     WHERE b.site = v_site AND b.idempotency_key = v_key;
    IF FOUND THEN
        IF v_existing.request_fingerprint IS DISTINCT FROM p_request_fingerprint
           OR v_existing.claim_secret_hash IS DISTINCT FROM p_claim_secret_hash THEN
            RAISE EXCEPTION 'guest_idempotency_conflict';
        END IF;
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'item_id', i.id, 'item_index', i.item_index, 'product_id', i.product_id,
            'sku_id', i.sku_id, 'product_name', i.snapshot_product_name,
            'sku_name', i.snapshot_sku_name, 'quantity', i.quantity,
            'unit_amount', i.unit_amount, 'total_amount', i.total_amount,
            'fulfillment_status', i.fulfillment_status) ORDER BY i.item_index), '[]'::JSONB)
          INTO v_items FROM public.guest_shop_checkout_items i WHERE i.batch_id = v_existing.id;
        RETURN QUERY SELECT v_existing.id, v_existing.batch_no, v_existing.existing_payment_id,
            v_existing.existing_merchant_no, v_existing.site::TEXT, v_existing.currency::TEXT,
            v_existing.total_amount, v_existing.expires_at, v_existing.payment_status, v_items;
        RETURN;
    END IF;

    INSERT INTO public.guest_shop_checkout_batches(batch_no, idempotency_key, request_fingerprint,
        site, currency, provider, channel, total_amount, claim_secret_hash, expires_at)
    VALUES ('pending-' || replace(gen_random_uuid()::TEXT, '-', ''), v_key, p_request_fingerprint,
        v_site, v_currency, v_provider, v_channel, 0, p_claim_secret_hash, v_expires)
    RETURNING id, batch_no INTO v_batch_id, v_batch_no;
    v_batch_no := 'GCB-' || to_char(v_now AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS') || '-' || upper(substr(replace(v_batch_id::TEXT, '-', ''), 1, 12));
    UPDATE public.guest_shop_checkout_batches SET batch_no = v_batch_no WHERE id = v_batch_id;

    FOR v_item_row IN
        SELECT value, (ordinality - 1)::INTEGER AS item_index
        FROM jsonb_array_elements(p_items) WITH ORDINALITY
        ORDER BY value->>'productId', value->>'skuId', value->>'quantity'
    LOOP
        v_item := v_item_row.value;
        v_index := v_item_row.item_index;
        v_product_id := NULLIF(v_item->>'productId', '')::UUID;
        v_sku_id := NULLIF(v_item->>'skuId', '')::UUID;
        v_quantity := COALESCE((v_item->>'quantity')::INTEGER, 1);
        IF v_product_id IS NULL OR v_sku_id IS NULL OR v_quantity < 1 OR v_quantity > 99 THEN
            RAISE EXCEPTION 'guest_checkout_batch_invalid_item';
        END IF;
        SELECT * INTO v_product FROM public.shop_products WHERE id = v_product_id FOR UPDATE;
        IF NOT FOUND OR COALESCE(v_product.is_active, false) IS NOT TRUE
           OR COALESCE(v_product.allow_guest_purchase, false) IS NOT TRUE THEN
            RAISE EXCEPTION 'guest_product_unavailable';
        END IF;
        SELECT * INTO v_sku FROM public.shop_product_skus WHERE id = v_sku_id AND product_id = v_product_id FOR UPDATE;
        IF NOT FOUND OR COALESCE(v_sku.is_active, false) IS NOT TRUE
           OR COALESCE(v_sku.allow_guest_purchase, v_product.allow_guest_purchase, false) IS NOT TRUE THEN
            RAISE EXCEPTION 'guest_sku_unavailable';
        END IF;
        IF UPPER(BTRIM(COALESCE(v_product.delivery_type, 'KEY'))) <> 'KEY'
           OR COALESCE(v_product.manual_delivery, false) OR COALESCE(v_sku.manual_delivery, false) THEN
            RAISE EXCEPTION 'guest_delivery_mode_unsupported';
        END IF;
        v_allowed := COALESCE(v_sku.guest_payment_channels, v_product.guest_payment_channels, '[]'::JSONB);
        IF jsonb_typeof(v_allowed) <> 'array' OR jsonb_array_length(v_allowed) = 0
           OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_allowed) a(value)
                          WHERE LOWER(BTRIM(a.value)) IN (v_provider, v_channel, v_provider || ':' || v_channel)) THEN
            RAISE EXCEPTION 'guest_payment_channel_unavailable';
        END IF;
        v_unit := public.guest_shop_resolve_credit_unit_amount(v_site, v_sku.price_points,
            v_sku.price_points_intl, COALESCE(v_sku.is_default, false), v_sku.quantity_rules,
            v_sku.quantity_rules_intl, v_product.quantity_rules, v_product.quantity_rules_intl,
            v_product.flash_sale_price, v_product.flash_sale_price_intl, v_product.flash_sale_end,
            v_product.flash_sale_end_intl, v_quantity, v_now);
        IF v_unit IS NULL OR v_unit <= 0 THEN RAISE EXCEPTION 'guest_credit_price_unavailable'; END IF;
        v_unit := ROUND(v_unit, 2);
        v_item_total := ROUND(v_unit * v_quantity, 2);
        INSERT INTO public.guest_shop_checkout_items(batch_id, item_index, product_id, sku_id,
            snapshot_product_name, snapshot_sku_name, quantity, unit_amount, total_amount)
        VALUES (v_batch_id, v_index, v_product_id, v_sku_id, COALESCE(v_product.name, ''), COALESCE(v_sku.sku_name, ''), v_quantity, v_unit, v_item_total)
        RETURNING id INTO v_item_id;

        v_requested := v_quantity;
        v_reserved := 0;
        FOR v_inventory IN
            SELECT i.id, i.product_id, i.sku_id, src.source_sku_id
            FROM public.shop_inventory i
            JOIN LATERAL public.fn_resolve_shop_sku_inventory_sources(v_sku_id, v_site) src
              ON src.source_sku_id = i.sku_id
              OR (src.source_is_default AND i.sku_id IS NULL)
             WHERE i.product_id = v_product_id
               AND i.status = 'available' AND COALESCE(i.is_shared, false) = false
             ORDER BY src.source_rank, i.created_at, i.id
             LIMIT v_quantity FOR UPDATE OF i SKIP LOCKED
        LOOP
            UPDATE public.shop_inventory SET status = 'reserve' WHERE id = v_inventory.id AND status = 'available';
            IF FOUND THEN
                v_source_sku_id := v_inventory.source_sku_id;
                INSERT INTO public.guest_shop_checkout_reservations(batch_id, item_id, inventory_id,
                    product_id, sku_id, site, reserved_until)
                VALUES (v_batch_id, v_item_id, v_inventory.id, v_product_id, v_source_sku_id, v_site, v_expires);
                v_reserved := v_reserved + 1;
            END IF;
        END LOOP;
        IF v_reserved <> v_requested THEN
            RAISE EXCEPTION 'guest_checkout_stock_insufficient:%:%:%:%', v_product.name, v_sku.sku_name, v_requested, v_reserved;
        END IF;
        v_total := v_total + v_item_total;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
            'item_id', v_item_id, 'item_index', v_index, 'product_id', v_product_id,
            'sku_id', v_sku_id, 'product_name', v_product.name, 'sku_name', v_sku.sku_name,
            'quantity', v_quantity, 'unit_amount', v_unit, 'total_amount', v_item_total,
            'fulfillment_status', 'pending'));
    END LOOP;

    UPDATE public.guest_shop_checkout_batches SET total_amount = v_total WHERE id = v_batch_id;
    INSERT INTO public.guest_shop_checkout_payments(batch_id, merchant_order_no, provider, channel,
        site, currency, expected_amount, expires_at)
    VALUES (v_batch_id, v_batch_no, v_provider, v_channel, v_site, v_currency, v_total, v_expires)
    RETURNING id INTO v_payment_id;
    RETURN QUERY SELECT v_batch_id, v_batch_no, v_payment_id, v_batch_no, v_site, v_currency,
        v_total, v_expires, 'pending'::TEXT, v_items;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_guest_shop_confirm_checkout_batch_payment(
    p_payment_id UUID, p_provider TEXT, p_provider_order_no TEXT,
    p_observed_amount NUMERIC, p_observed_status TEXT
)
RETURNS TABLE (batch_id UUID, batch_no TEXT, payment_status TEXT, fulfillment_status TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_payment public.guest_shop_checkout_payments%ROWTYPE; v_batch public.guest_shop_checkout_batches%ROWTYPE;
BEGIN
    PERFORM public.guest_shop_require_service_role();
    SELECT * INTO v_payment FROM public.guest_shop_checkout_payments WHERE id = p_payment_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'guest_checkout_payment_not_found'; END IF;
    SELECT * INTO v_batch FROM public.guest_shop_checkout_batches WHERE id = v_payment.batch_id FOR UPDATE;
    IF v_payment.provider <> LOWER(BTRIM(COALESCE(p_provider, ''))) THEN
        RAISE EXCEPTION 'guest_payment_binding_mismatch';
    END IF;
    IF NULLIF(BTRIM(p_provider_order_no), '') IS NULL THEN
        RAISE EXCEPTION 'guest_payment_provider_order_missing';
    END IF;
    IF v_payment.provider_order_no IS NOT NULL
       AND v_payment.provider_order_no <> BTRIM(p_provider_order_no) THEN
        RAISE EXCEPTION 'guest_payment_binding_mismatch';
    END IF;
    IF ROUND(COALESCE(p_observed_amount, 0), 2) <> v_payment.expected_amount THEN RAISE EXCEPTION 'guest_payment_amount_mismatch'; END IF;
    IF LOWER(BTRIM(COALESCE(p_observed_status, ''))) NOT IN ('paid', 'confirmed', 'complete', 'completed', 'success') THEN
        RAISE EXCEPTION 'guest_payment_status_not_final';
    END IF;
    IF v_payment.status <> 'confirmed' THEN
        UPDATE public.guest_shop_checkout_payments SET provider_order_no = NULLIF(BTRIM(p_provider_order_no), ''),
            paid_amount = v_payment.expected_amount, status = 'confirmed', paid_at = clock_timestamp(), updated_at = clock_timestamp()
            WHERE id = v_payment.id;
        UPDATE public.guest_shop_checkout_batches SET payment_status = 'confirmed', paid_at = clock_timestamp(), updated_at = clock_timestamp()
            WHERE id = v_batch.id AND payment_status <> 'confirmed';
    END IF;
    RETURN QUERY SELECT v_batch.id, v_batch.batch_no, 'confirmed'::TEXT, v_batch.fulfillment_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_guest_shop_claim_checkout_batch(p_batch_id UUID)
RETURNS TABLE (
    item_id UUID,
    item_index INTEGER,
    product_id UUID,
    sku_id UUID,
    product_name TEXT,
    sku_name TEXT,
    quantity INTEGER,
    content TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_batch public.guest_shop_checkout_batches%ROWTYPE; v_item RECORD; v_res RECORD; v_inv RECORD; v_count INTEGER; v_consumed INTEGER; v_invalid INTEGER;
BEGIN
    PERFORM public.guest_shop_require_service_role();
    SELECT * INTO v_batch FROM public.guest_shop_checkout_batches WHERE id = p_batch_id FOR UPDATE;
    IF NOT FOUND OR v_batch.payment_status <> 'confirmed' THEN RAISE EXCEPTION 'guest_payment_not_confirmed'; END IF;
    IF v_batch.fulfillment_status = 'paid_unfulfillable' THEN RETURN; END IF;
    SELECT COUNT(*), COUNT(*) FILTER (WHERE r.status = 'consumed')
      INTO v_count, v_consumed
      FROM public.guest_shop_checkout_reservations r WHERE r.batch_id = p_batch_id;
    IF v_count = 0 THEN RAISE EXCEPTION 'guest_inventory_not_reservable'; END IF;
    -- A retry after delivery returns the same immutable contents.  This keeps
    -- claim idempotent while still letting the client display every SKU.
    IF v_batch.fulfillment_status = 'delivered' OR v_consumed = v_count THEN
        FOR v_res IN SELECT r.* FROM public.guest_shop_checkout_reservations r WHERE r.batch_id = p_batch_id ORDER BY r.created_at, r.id LOOP
            SELECT * INTO v_inv FROM public.shop_inventory WHERE id = v_res.inventory_id FOR UPDATE;
            IF NOT FOUND OR v_res.status <> 'consumed' OR v_inv.status <> 'sold' OR COALESCE(v_inv.is_shared, false) THEN
                RAISE EXCEPTION 'guest_inventory_not_reservable';
            END IF;
            SELECT i.* INTO v_item FROM public.guest_shop_checkout_items i WHERE i.id = v_res.item_id;
            item_id := v_res.item_id; item_index := v_item.item_index; product_id := v_item.product_id; sku_id := v_item.sku_id;
            product_name := v_item.snapshot_product_name; sku_name := v_item.snapshot_sku_name; quantity := v_item.quantity; content := v_inv.content;
            RETURN NEXT;
        END LOOP;
        RETURN;
    END IF;
    IF v_consumed > 0 THEN RAISE EXCEPTION 'guest_inventory_not_reservable'; END IF;
    SELECT COUNT(*) INTO v_invalid
      FROM public.guest_shop_checkout_reservations r
      LEFT JOIN public.shop_inventory i ON i.id = r.inventory_id
     WHERE r.batch_id = p_batch_id
       AND (i.id IS NULL OR i.status <> 'reserve' OR COALESCE(i.is_shared, false));
    IF v_invalid > 0 THEN
        UPDATE public.guest_shop_checkout_items
           SET fulfillment_status = 'paid_unfulfillable',
               last_error_code = 'guest_inventory_not_reservable',
               last_error_message = '支付成功后库存状态异常',
               updated_at = clock_timestamp()
         WHERE batch_id = p_batch_id AND fulfillment_status <> 'delivered';
        UPDATE public.guest_shop_checkout_batches
           SET fulfillment_status = 'paid_unfulfillable',
               refund_status = CASE WHEN refund_status = 'succeeded' THEN refund_status ELSE 'pending' END,
               last_error_code = 'guest_inventory_not_reservable',
               last_error_message = '支付成功后库存状态异常',
               updated_at = clock_timestamp()
         WHERE id = p_batch_id;
        RETURN;
    END IF;
    FOR v_item IN SELECT i.* FROM public.guest_shop_checkout_items i WHERE i.batch_id = p_batch_id ORDER BY i.item_index LOOP
        FOR v_res IN SELECT r.* FROM public.guest_shop_checkout_reservations r WHERE r.item_id = v_item.id ORDER BY r.created_at, r.id LOOP
            SELECT * INTO v_inv FROM public.shop_inventory WHERE id = v_res.inventory_id FOR UPDATE;
            UPDATE public.shop_inventory SET status = 'sold', sold_at = COALESCE(sold_at, clock_timestamp()) WHERE id = v_res.inventory_id AND status = 'reserve';
            IF NOT FOUND THEN RAISE EXCEPTION 'guest_inventory_not_reservable'; END IF;
            UPDATE public.guest_shop_checkout_reservations SET status = 'consumed', consumed_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = v_res.id AND status = 'held';
            item_id := v_item.id; item_index := v_item.item_index; product_id := v_item.product_id; sku_id := v_item.sku_id;
            product_name := v_item.snapshot_product_name; sku_name := v_item.snapshot_sku_name; quantity := v_item.quantity; content := v_inv.content;
            RETURN NEXT;
        END LOOP;
        UPDATE public.guest_shop_checkout_items SET fulfillment_status = 'delivered', delivered_at = COALESCE(delivered_at, clock_timestamp()), updated_at = clock_timestamp() WHERE id = v_item.id;
    END LOOP;
    UPDATE public.guest_shop_checkout_batches SET fulfillment_status = 'delivered', fulfilled_at = COALESCE(fulfilled_at, clock_timestamp()), updated_at = clock_timestamp() WHERE id = p_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_guest_shop_create_checkout_batch(TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_confirm_checkout_batch_payment(UUID, TEXT, TEXT, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_claim_checkout_batch(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_create_checkout_batch(TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_guest_shop_confirm_checkout_batch_payment(UUID, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_guest_shop_claim_checkout_batch(UUID) FROM PUBLIC, anon, authenticated;
