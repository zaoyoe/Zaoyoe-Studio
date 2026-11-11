-- Pre-launch anti-inventory-lock hardening for Guest Shop (ordinary orders + cart batches).
--
-- Why this forward migration exists:
-- 1. 20260928_guest_shop_promo_guard_scope.sql scoped fn_guest_shop_enforce_promo_safety_gates()
--    to discounted orders only, leaving list-price orders and cart checkout batches without
--    per-IP/per-contact open-order limits or stock-hold exhaustion protection.
-- 2. Historical migrations (20260924, 20260926, 20260928) and their verify queries are
--    locked by archive contract tests and must remain untouched.
-- 3. Default unpaid reservation TTL is tightened to 300 seconds (5 minutes).

ALTER TABLE public.guest_shop_checkout_batches
    ADD COLUMN IF NOT EXISTS buyer_contact_hash TEXT,
    ADD COLUMN IF NOT EXISTS request_ip_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_guest_shop_checkout_batches_open_contact
    ON public.guest_shop_checkout_batches(buyer_contact_hash, expires_at)
    WHERE payment_status IN ('pending', 'created', 'review')
      AND buyer_contact_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_guest_shop_checkout_batches_open_ip
    ON public.guest_shop_checkout_batches(request_ip_hash, expires_at)
    WHERE payment_status IN ('pending', 'created', 'review')
      AND request_ip_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_guest_shop_orders_global_open_ip
    ON public.guest_shop_orders(request_ip_hash, expires_at)
    WHERE source_channel = 'website_guest'
      AND payment_status IN ('pending', 'created', 'review')
      AND reservation_status = 'held'
      AND request_ip_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_guest_shop_orders_global_open_contact
    ON public.guest_shop_orders(buyer_contact_hash, expires_at)
    WHERE source_channel = 'website_guest'
      AND payment_status IN ('pending', 'created', 'review')
      AND reservation_status = 'held'
      AND buyer_contact_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_guest_shop_create_checkout_batch(
    p_site TEXT,
    p_items JSONB,
    p_idempotency_key TEXT,
    p_request_fingerprint TEXT,
    p_claim_secret_hash TEXT,
    p_provider TEXT,
    p_channel TEXT,
    p_ttl_seconds INTEGER DEFAULT 300
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
    v_sku_quantity_cap INTEGER;
    v_total_quantity INTEGER := 0;
    v_distinct_items INTEGER := 0;
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
       OR jsonb_array_length(p_items) > 10 THEN
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

    SELECT COUNT(DISTINCT (COALESCE(value->>'productId', '') || ':' || COALESCE(value->>'skuId', '')))
      INTO v_distinct_items
      FROM jsonb_array_elements(p_items) AS value;
    IF v_distinct_items <> jsonb_array_length(p_items) THEN
        RAISE EXCEPTION 'guest_checkout_batch_duplicate_item';
    END IF;

    v_expires := v_now + make_interval(secs => p_ttl_seconds);
    PERFORM pg_advisory_xact_lock(hashtextextended(v_site || ':cart:' || v_key, 0));

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
    RETURNING guest_shop_checkout_batches.id, guest_shop_checkout_batches.batch_no INTO v_batch_id, v_batch_no;
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
        SELECT * INTO v_sku FROM public.shop_product_skus AS sku WHERE sku.id = v_sku_id AND sku.product_id = v_product_id FOR UPDATE;
        IF NOT FOUND OR COALESCE(v_sku.is_active, false) IS NOT TRUE
           OR COALESCE(v_sku.allow_guest_purchase, v_product.allow_guest_purchase, false) IS NOT TRUE THEN
            RAISE EXCEPTION 'guest_sku_unavailable';
        END IF;
        v_sku_quantity_cap := LEAST(
            99,
            GREATEST(1, COALESCE(v_sku.guest_max_quantity, v_product.guest_max_quantity, 10)),
            GREATEST(1, COALESCE(v_product.max_purchase_quantity, 99))
        );
        IF v_quantity > v_sku_quantity_cap THEN
            RAISE EXCEPTION 'guest_quantity_not_allowed';
        END IF;
        v_total_quantity := v_total_quantity + v_quantity;
        IF v_total_quantity > 30 THEN
            RAISE EXCEPTION 'guest_quantity_not_allowed';
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

REVOKE ALL ON FUNCTION public.fn_guest_shop_create_checkout_batch(TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_create_checkout_batch(TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_guest_shop_enforce_global_anti_hoarding_gates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now TIMESTAMPTZ := clock_timestamp();
    v_site TEXT;
    v_product_id UUID;
    v_sku_id UUID;
    v_identity_contact TEXT;
    v_identity_ip TEXT;
    v_open_orders BIGINT := 0;
    v_open_batches BIGINT := 0;
    v_source_ids UUID[];
    v_source_default BOOLEAN;
    v_held_orders BIGINT := 0;
    v_held_batches BIGINT := 0;
    v_held_total BIGINT := 0;
    v_available BIGINT := 0;
    v_pool_total BIGINT := 0;
    v_max_allowed_held BIGINT := 2;
    v_order public.guest_shop_orders%ROWTYPE;
    v_batch public.guest_shop_checkout_batches%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RETURN NULL;
    END IF;

    IF TG_TABLE_NAME = 'guest_shop_orders' THEN
        v_order := NEW;
        IF v_order.id IS NULL
           OR v_order.source_channel <> 'website_guest'
           OR v_order.payment_status NOT IN ('pending', 'created', 'review')
           OR v_order.reservation_status <> 'held'
           OR v_order.expires_at <= v_now THEN
            RETURN NULL;
        END IF;
        v_site := v_order.site;
        v_product_id := v_order.product_id;
        v_sku_id := v_order.sku_id;
        v_identity_contact := NULLIF(BTRIM(COALESCE(v_order.buyer_contact_hash, '')), '');
        v_identity_ip := NULLIF(BTRIM(COALESCE(v_order.request_ip_hash, '')), '');
    ELSIF TG_TABLE_NAME = 'guest_shop_inventory_reservations' THEN
        IF NEW.status <> 'held' OR NEW.reserved_until <= v_now THEN
            RETURN NULL;
        END IF;
        SELECT o.* INTO v_order FROM public.guest_shop_orders o WHERE o.id = NEW.order_id;
        IF v_order.id IS NULL
           OR v_order.source_channel <> 'website_guest'
           OR v_order.payment_status NOT IN ('pending', 'created', 'review')
           OR v_order.reservation_status <> 'held'
           OR v_order.expires_at <= v_now THEN
            RETURN NULL;
        END IF;
        v_site := v_order.site;
        v_product_id := v_order.product_id;
        v_sku_id := v_order.sku_id;
        v_identity_contact := NULLIF(BTRIM(COALESCE(v_order.buyer_contact_hash, '')), '');
        v_identity_ip := NULLIF(BTRIM(COALESCE(v_order.request_ip_hash, '')), '');
    ELSIF TG_TABLE_NAME = 'guest_shop_checkout_batches' THEN
        v_batch := NEW;
        IF v_batch.id IS NULL
           OR v_batch.payment_status NOT IN ('pending', 'created', 'review')
           OR v_batch.expires_at <= v_now THEN
            RETURN NULL;
        END IF;
        v_site := v_batch.site;
        v_identity_contact := COALESCE(
            NULLIF(BTRIM(COALESCE(v_batch.buyer_contact_hash, '')), ''),
            NULLIF(BTRIM(COALESCE(v_batch.metadata->>'buyer_contact_hash', '')), '')
        );
        v_identity_ip := COALESCE(
            NULLIF(BTRIM(COALESCE(v_batch.request_ip_hash, '')), ''),
            NULLIF(BTRIM(COALESCE(v_batch.metadata->>'request_ip_hash', '')), '')
        );
    ELSIF TG_TABLE_NAME = 'guest_shop_checkout_reservations' THEN
        IF NEW.status <> 'held' OR NEW.reserved_until <= v_now THEN
            RETURN NULL;
        END IF;
        SELECT b.* INTO v_batch FROM public.guest_shop_checkout_batches b WHERE b.id = NEW.batch_id;
        IF v_batch.id IS NULL
           OR v_batch.payment_status NOT IN ('pending', 'created', 'review')
           OR v_batch.expires_at <= v_now THEN
            RETURN NULL;
        END IF;
        v_site := NEW.site;
        v_product_id := NEW.product_id;
        v_sku_id := NEW.sku_id;
        v_identity_contact := COALESCE(
            NULLIF(BTRIM(COALESCE(v_batch.buyer_contact_hash, '')), ''),
            NULLIF(BTRIM(COALESCE(v_batch.metadata->>'buyer_contact_hash', '')), '')
        );
        v_identity_ip := COALESCE(
            NULLIF(BTRIM(COALESCE(v_batch.request_ip_hash, '')), ''),
            NULLIF(BTRIM(COALESCE(v_batch.metadata->>'request_ip_hash', '')), '')
        );
    ELSE
        RETURN NULL;
    END IF;

    IF v_identity_contact IS NOT NULL OR v_identity_ip IS NOT NULL THEN
        IF v_identity_contact IS NOT NULL THEN
            PERFORM pg_advisory_xact_lock(hashtextextended('guest-global-contact:' || v_identity_contact, 0));
        END IF;
        IF v_identity_ip IS NOT NULL THEN
            PERFORM pg_advisory_xact_lock(hashtextextended('guest-global-ip:' || v_identity_ip, 0));
        END IF;

        SELECT COUNT(DISTINCT o.id)
          INTO v_open_orders
          FROM public.guest_shop_orders o
         WHERE o.source_channel = 'website_guest'
           AND o.payment_status IN ('pending', 'created', 'review')
           AND o.reservation_status = 'held'
           AND o.expires_at > v_now
           AND (
               (v_identity_contact IS NOT NULL AND o.buyer_contact_hash = v_identity_contact)
               OR (v_identity_ip IS NOT NULL AND o.request_ip_hash = v_identity_ip)
           );

        SELECT COUNT(DISTINCT b.id)
          INTO v_open_batches
          FROM public.guest_shop_checkout_batches b
         WHERE b.payment_status IN ('pending', 'created', 'review')
           AND b.expires_at > v_now
           AND (
               (v_identity_contact IS NOT NULL AND (
                   b.buyer_contact_hash = v_identity_contact
                   OR b.metadata->>'buyer_contact_hash' = v_identity_contact
               ))
               OR (v_identity_ip IS NOT NULL AND (
                   b.request_ip_hash = v_identity_ip
                   OR b.metadata->>'request_ip_hash' = v_identity_ip
               ))
           );

        IF (v_open_orders + v_open_batches) > 2 THEN
            RAISE EXCEPTION 'guest_open_orders_limit';
        END IF;
    END IF;

    IF v_product_id IS NOT NULL AND v_sku_id IS NOT NULL AND v_site IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(
            'guest-global-stock:' || v_site || ':' || v_product_id::TEXT || ':' || v_sku_id::TEXT,
            0
        ));

        SELECT COALESCE(array_agg(src.source_sku_id ORDER BY src.source_rank), ARRAY[]::UUID[]),
               COALESCE(bool_or(src.source_is_default), false)
          INTO v_source_ids, v_source_default
          FROM public.fn_resolve_shop_sku_inventory_sources(v_sku_id, v_site) src;

        SELECT COUNT(*)
          INTO v_held_orders
          FROM public.guest_shop_inventory_reservations r
          JOIN public.guest_shop_orders o ON o.id = r.order_id
         WHERE o.source_channel = 'website_guest'
           AND o.payment_status IN ('pending', 'created', 'review')
           AND r.product_id = v_product_id
           AND r.site = v_site
           AND r.status = 'held'
           AND r.reserved_until > v_now
           AND r.inventory_source_sku_id = ANY(COALESCE(v_source_ids, ARRAY[]::UUID[]));

        SELECT COUNT(*)
          INTO v_held_batches
          FROM public.guest_shop_checkout_reservations br
          JOIN public.guest_shop_checkout_batches b ON b.id = br.batch_id
         WHERE b.payment_status IN ('pending', 'created', 'review')
           AND br.product_id = v_product_id
           AND br.site = v_site
           AND br.status = 'held'
           AND br.reserved_until > v_now
           AND br.sku_id = ANY(COALESCE(v_source_ids, ARRAY[]::UUID[]));

        SELECT COUNT(*)
          INTO v_available
          FROM public.shop_inventory i
         WHERE i.product_id = v_product_id
           AND i.status = 'available'
           AND COALESCE(i.is_shared, false) = false
           AND (
               i.sku_id = ANY(COALESCE(v_source_ids, ARRAY[]::UUID[]))
               OR (v_source_default AND i.sku_id IS NULL)
           );

        v_held_total := v_held_orders + v_held_batches;
        v_pool_total := v_held_total + v_available;
        -- Adaptive anti-hoarding ceiling:
        -- Always allow up to 2 held items so low-stock SKUs (1..6 items) never
        -- deadlock normal buyers, while capping unpaid holds at 30% of the pool
        -- on larger inventory pools so bots cannot lock out an entire SKU.
        v_max_allowed_held := GREATEST(2, FLOOR(v_pool_total * 0.30)::BIGINT);

        IF v_pool_total > 2 AND v_held_total > v_max_allowed_held THEN
            RAISE EXCEPTION 'guest_stock_hold_limit';
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guest_shop_enforce_global_anti_hoarding_gates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_enforce_global_anti_hoarding_gates() TO service_role;

DROP TRIGGER IF EXISTS guest_shop_global_order_anti_hoarding_gates ON public.guest_shop_orders;
CREATE CONSTRAINT TRIGGER guest_shop_global_order_anti_hoarding_gates
    AFTER INSERT OR UPDATE OF buyer_contact_hash, request_ip_hash, payment_status,
        reservation_status, expires_at, product_id, sku_id, site
    ON public.guest_shop_orders
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_guest_shop_enforce_global_anti_hoarding_gates();

DROP TRIGGER IF EXISTS guest_shop_global_reservation_anti_hoarding_gates
    ON public.guest_shop_inventory_reservations;
CREATE CONSTRAINT TRIGGER guest_shop_global_reservation_anti_hoarding_gates
    AFTER INSERT OR UPDATE OF status, reserved_until, order_id, product_id, sku_id, site
    ON public.guest_shop_inventory_reservations
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_guest_shop_enforce_global_anti_hoarding_gates();

DROP TRIGGER IF EXISTS guest_shop_global_batch_anti_hoarding_gates
    ON public.guest_shop_checkout_batches;
CREATE CONSTRAINT TRIGGER guest_shop_global_batch_anti_hoarding_gates
    AFTER INSERT OR UPDATE OF buyer_contact_hash, request_ip_hash, metadata,
        payment_status, expires_at, site
    ON public.guest_shop_checkout_batches
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_guest_shop_enforce_global_anti_hoarding_gates();

DROP TRIGGER IF EXISTS guest_shop_global_batch_reservation_anti_hoarding_gates
    ON public.guest_shop_checkout_reservations;
CREATE CONSTRAINT TRIGGER guest_shop_global_batch_reservation_anti_hoarding_gates
    AFTER INSERT OR UPDATE OF status, reserved_until, batch_id, product_id, sku_id, site
    ON public.guest_shop_checkout_reservations
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_guest_shop_enforce_global_anti_hoarding_gates();
