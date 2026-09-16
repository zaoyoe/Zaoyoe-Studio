-- Guest shop credit-price settlement.
-- Codex does not execute this file. Run it in the target Supabase SQL editor
-- only after the matching code/tests are complete. This migration is additive:
-- it does not DROP tables, does not CASCADE, does not rollback 20260913/20260914,
-- and does not enable guest products.
--
-- Guest checkout reuses the logged-in SKU credit/tier/flash price. 1 credit = 1 CNY.
-- Both CN and INTL settle in CNY. ZPay charges CNY; NOWPayments converts CNY to a
-- USD quote and USDT-BEP20 using the recharge path. Leftover cash-price columns
-- are kept but no longer read by create-order. Create-order still never accepts a
-- client amount.

-- Fail loudly if leftover non-CNY settlement rows exist. Do not silently convert.
DO $$
DECLARE
    v_bad_orders BIGINT;
    v_bad_payments BIGINT;
BEGIN
    SELECT COUNT(*) INTO v_bad_orders
    FROM public.guest_shop_orders
    WHERE currency IS DISTINCT FROM 'CNY';

    SELECT COUNT(*) INTO v_bad_payments
    FROM public.guest_shop_payment_orders
    WHERE currency IS DISTINCT FROM 'CNY';

    IF v_bad_orders > 0 OR v_bad_payments > 0 THEN
        RAISE EXCEPTION 'guest_shop_non_cny_rows_exist: orders=%, payments=%',
            v_bad_orders, v_bad_payments;
    END IF;
END;
$$;

ALTER TABLE public.guest_shop_orders
    DROP CONSTRAINT IF EXISTS guest_shop_orders_currency_check,
    DROP CONSTRAINT IF EXISTS guest_shop_orders_site_currency_check,
    ADD CONSTRAINT guest_shop_orders_currency_check
        CHECK (currency = 'CNY'),
    ADD CONSTRAINT guest_shop_orders_site_currency_check
        CHECK ((site = 'cn' AND currency = 'CNY') OR (site = 'intl' AND currency = 'CNY'));

ALTER TABLE public.guest_shop_payment_orders
    DROP CONSTRAINT IF EXISTS guest_shop_payment_orders_currency_check,
    DROP CONSTRAINT IF EXISTS guest_shop_payment_orders_site_currency_check,
    ADD CONSTRAINT guest_shop_payment_orders_currency_check
        CHECK (currency = 'CNY'),
    ADD CONSTRAINT guest_shop_payment_orders_site_currency_check
        CHECK ((site = 'cn' AND currency = 'CNY') OR (site = 'intl' AND currency = 'CNY'));

CREATE OR REPLACE FUNCTION public.guest_shop_resolve_credit_unit_amount(
    p_site TEXT,
    p_sku_price_points NUMERIC,
    p_sku_price_points_intl NUMERIC,
    p_sku_is_default BOOLEAN,
    p_sku_quantity_rules JSONB,
    p_sku_quantity_rules_intl JSONB,
    p_product_quantity_rules JSONB,
    p_product_quantity_rules_intl JSONB,
    p_product_flash_sale_price NUMERIC,
    p_product_flash_sale_price_intl NUMERIC,
    p_product_flash_sale_end TIMESTAMP WITH TIME ZONE,
    p_product_flash_sale_end_intl TIMESTAMP WITH TIME ZONE,
    p_quantity INTEGER,
    p_now TIMESTAMP WITH TIME ZONE
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_site TEXT := LOWER(BTRIM(COALESCE(p_site, '')));
    v_base NUMERIC;
    v_rules JSONB;
    v_flash_price NUMERIC;
    v_flash_end TIMESTAMP WITH TIME ZONE;
    v_now TIMESTAMP WITH TIME ZONE := COALESCE(p_now, clock_timestamp());
    v_rule JSONB;
    v_rule_qty INTEGER;
    v_rule_price NUMERIC;
    v_result NUMERIC(14,2);
BEGIN
    IF v_site NOT IN ('cn', 'intl') THEN
        RETURN NULL;
    END IF;
    IF p_quantity IS DISTINCT FROM 1 THEN
        RETURN NULL;
    END IF;

    IF v_site = 'intl' THEN
        v_base := p_sku_price_points_intl;
        v_rules := COALESCE(
            p_sku_quantity_rules_intl,
            CASE
                WHEN p_sku_is_default IS TRUE THEN p_product_quantity_rules_intl
                ELSE NULL
            END
        );
        v_flash_price := p_product_flash_sale_price_intl;
        v_flash_end := p_product_flash_sale_end_intl;
    ELSE
        v_base := p_sku_price_points;
        v_rules := COALESCE(
            p_sku_quantity_rules,
            CASE
                WHEN p_sku_is_default IS TRUE THEN p_product_quantity_rules
                ELSE NULL
            END
        );
        v_flash_price := p_product_flash_sale_price;
        v_flash_end := p_product_flash_sale_end;
    END IF;

    IF v_base IS NULL
       OR LOWER(v_base::TEXT) IN ('nan', 'infinity', '-infinity')
       OR v_base <= 0 THEN
        RETURN NULL;
    END IF;

    IF v_flash_end IS NOT NULL
       AND v_flash_end > v_now
       AND v_flash_price IS NOT NULL
       AND LOWER(v_flash_price::TEXT) NOT IN ('nan', 'infinity', '-infinity') THEN
        v_base := LEAST(v_base, v_flash_price);
    ELSIF v_rules IS NOT NULL
          AND jsonb_typeof(v_rules) = 'array'
          AND jsonb_array_length(v_rules) > 0 THEN
        FOR v_rule IN SELECT * FROM jsonb_array_elements(v_rules)
        LOOP
            v_rule_qty := NULL;
            v_rule_price := NULL;
            BEGIN
                v_rule_qty := (v_rule->>'qty')::INTEGER;
                v_rule_price := COALESCE(NULLIF(BTRIM(COALESCE(v_rule->>'price', '')), ''), '0')::NUMERIC;
            EXCEPTION WHEN OTHERS THEN
                v_rule_qty := NULL;
                v_rule_price := NULL;
            END;
            IF v_rule_qty IS NOT NULL
               AND v_rule_qty >= 1
               AND p_quantity >= v_rule_qty
               AND v_rule_price IS NOT NULL
               AND LOWER(v_rule_price::TEXT) NOT IN ('nan', 'infinity', '-infinity')
               AND v_rule_price < v_base THEN
                v_base := v_rule_price;
            END IF;
        END LOOP;
    END IF;

    IF v_base IS NULL
       OR LOWER(v_base::TEXT) IN ('nan', 'infinity', '-infinity')
       OR v_base <= 0 THEN
        RETURN NULL;
    END IF;

    v_result := ROUND(v_base, 2);
    IF v_result IS NULL OR v_result <= 0 THEN
        RETURN NULL;
    END IF;
    RETURN v_result;
END;
$$;


REVOKE ALL ON FUNCTION public.guest_shop_resolve_credit_unit_amount(TEXT, NUMERIC, NUMERIC, BOOLEAN, JSONB, JSONB, JSONB, JSONB, NUMERIC, NUMERIC, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, INTEGER, TIMESTAMP WITH TIME ZONE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_resolve_credit_unit_amount(TEXT, NUMERIC, NUMERIC, BOOLEAN, JSONB, JSONB, JSONB, JSONB, NUMERIC, NUMERIC, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, INTEGER, TIMESTAMP WITH TIME ZONE) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_guest_shop_create_order(
    p_site TEXT,
    p_product_id UUID,
    p_sku_id UUID,
    p_idempotency_key TEXT,
    p_request_fingerprint TEXT,
    p_claim_secret_hash TEXT,
    p_provider TEXT,
    p_channel TEXT,
    p_buyer_contact_hash TEXT DEFAULT NULL,
    p_request_ip_hash TEXT DEFAULT NULL,
    p_request_device_hash TEXT DEFAULT NULL,
    p_ttl_seconds INTEGER DEFAULT 1800
)
RETURNS TABLE (
    order_id UUID,
    order_no TEXT,
    payment_order_id UUID,
    merchant_order_no TEXT,
    site TEXT,
    currency TEXT,
    unit_amount NUMERIC,
    total_amount NUMERIC,
    expires_at TIMESTAMPTZ,
    claim_secret_version SMALLINT,
    reservation_status TEXT,
    payment_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_site TEXT := public.guest_shop_normalize_site(p_site);
    v_currency TEXT;
    v_provider TEXT := LOWER(BTRIM(COALESCE(p_provider, '')));
    v_channel TEXT := LOWER(BTRIM(COALESCE(p_channel, '')));
    v_key TEXT := BTRIM(COALESCE(p_idempotency_key, ''));
    v_fingerprint TEXT := BTRIM(COALESCE(p_request_fingerprint, ''));
    v_product public.shop_products%ROWTYPE;
    v_sku public.shop_product_skus%ROWTYPE;
    v_source_sku public.shop_product_skus%ROWTYPE;
    v_unit_amount NUMERIC(14,2);
    v_order_id UUID;
    v_payment_order_id UUID;
    v_inventory_id UUID;
    v_order_no TEXT;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_expires_at TIMESTAMPTZ;
    v_existing RECORD;
    v_existing_payment RECORD;
    v_guest_enabled BOOLEAN;
    v_allowed_channels JSONB;
    v_delivery_type TEXT;
    v_raw_source_ids UUID[];
    v_configured_source_ids UUID[];
    v_source_ids UUID[];
    v_inventory_source_sku_id UUID;
BEGIN
    PERFORM public.guest_shop_require_service_role();

    IF v_site NOT IN ('cn', 'intl') THEN
        RAISE EXCEPTION 'guest_invalid_site';
    END IF;
    v_currency := 'CNY';

    IF p_product_id IS NULL OR p_sku_id IS NULL THEN
        RAISE EXCEPTION 'guest_product_or_sku_required';
    END IF;
    IF char_length(v_key) < 16 OR char_length(v_key) > 200 THEN
        RAISE EXCEPTION 'guest_invalid_idempotency_key';
    END IF;
    IF v_fingerprint !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'guest_invalid_request_fingerprint';
    END IF;
    IF p_claim_secret_hash IS NULL
       OR p_claim_secret_hash !~ '^hmac-sha256:v1:[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'guest_invalid_claim_secret_hash';
    END IF;
    IF p_ttl_seconds IS NULL OR p_ttl_seconds < 300 OR p_ttl_seconds > 7200 THEN
        RAISE EXCEPTION 'guest_invalid_order_ttl';
    END IF;
    IF v_provider = '' OR char_length(v_provider) > 80
       OR v_provider !~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
       OR v_provider IN ('mock', 'test', 'fake')
       OR v_channel = '' OR char_length(v_channel) > 80
       OR v_channel !~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
       OR v_channel IN ('mock', 'test', 'fake') THEN
        RAISE EXCEPTION 'guest_invalid_payment_provider';
    END IF;

    -- The advisory lock makes the idempotency lookup and inventory decision a
    -- single serial point even when two retries arrive simultaneously.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_site || ':' || v_key, 0));

    SELECT o.*,
           p.id AS existing_payment_order_id,
           p.merchant_order_no AS existing_merchant_order_no,
           p.status AS existing_payment_status
    INTO v_existing
    FROM public.guest_shop_orders o
    LEFT JOIN public.guest_shop_payment_orders p ON p.guest_order_id = o.id
    WHERE o.site = v_site
      AND o.idempotency_key = v_key;

    IF FOUND THEN
        IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
            RAISE EXCEPTION 'guest_idempotency_conflict';
        END IF;
        IF v_existing.claim_secret_hash IS DISTINCT FROM p_claim_secret_hash THEN
            RAISE EXCEPTION 'guest_idempotency_claim_secret_conflict';
        END IF;
        RETURN QUERY SELECT
            v_existing.id,
            v_existing.order_no,
            v_existing.existing_payment_order_id,
            v_existing.existing_merchant_order_no,
            v_existing.site::TEXT,
            v_existing.currency::TEXT,
            v_existing.unit_amount,
            v_existing.total_amount,
            v_existing.expires_at,
            v_existing.claim_secret_version,
            v_existing.reservation_status,
            v_existing.existing_payment_status;
        RETURN;
    END IF;

    -- Product then selected SKU then source SKU is the lock order used by all
    -- creation calls.  Source aliases stay within one product by migration
    -- constraints; P0 still rejects shared inventory itself below.
    SELECT * INTO v_product
    FROM public.shop_products
    WHERE id = p_product_id
    FOR UPDATE;
    IF NOT FOUND OR COALESCE(v_product.is_active, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'guest_product_unavailable';
    END IF;

    SELECT * INTO v_sku
    FROM public.shop_product_skus
    WHERE id = p_sku_id
      AND product_id = p_product_id
    FOR UPDATE;
    IF NOT FOUND OR COALESCE(v_sku.is_active, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'guest_sku_unavailable';
    END IF;

    -- P0 is automatic KEY delivery only. Manual/API products can never enter
    -- this cash channel, even if an operator accidentally enables guest sale.
    v_delivery_type := UPPER(BTRIM(COALESCE(v_product.delivery_type, 'KEY')));
    IF v_delivery_type <> 'KEY'
       OR COALESCE(v_product.manual_delivery, false)
       OR COALESCE(v_sku.manual_delivery, false) THEN
        RAISE EXCEPTION 'guest_delivery_mode_unsupported';
    END IF;

    -- Validate the raw configured source list before using the resolver.  The
    -- resolver intentionally uses joins and can omit a deleted source; a new
    -- guest order must instead fail closed when configuration is stale,
    -- cross-product, points at an inactive SKU, or contains a NULL that a
    -- convenience unnest() filter would otherwise silently discard.
    v_raw_source_ids := CASE
        WHEN v_site = 'intl'
             AND COALESCE(array_length(v_sku.inventory_source_sku_ids_intl, 1), 0) > 0
            THEN v_sku.inventory_source_sku_ids_intl
        WHEN v_site <> 'intl'
             AND COALESCE(array_length(v_sku.inventory_source_sku_ids, 1), 0) > 0
            THEN v_sku.inventory_source_sku_ids
        WHEN v_site = 'intl'
            THEN ARRAY[v_sku.id]::UUID[]
        WHEN v_sku.inventory_sku_id IS NOT NULL
            THEN ARRAY[v_sku.inventory_sku_id]::UUID[]
        ELSE ARRAY[v_sku.id]::UUID[]
    END;
    IF v_raw_source_ids IS NULL
       OR COALESCE(array_length(v_raw_source_ids, 1), 0) = 0
       OR array_position(v_raw_source_ids, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'guest_inventory_source_invalid';
    END IF;

    SELECT COALESCE(array_agg(source_id ORDER BY first_rank), ARRAY[]::UUID[])
    INTO v_configured_source_ids
    FROM (
        SELECT source_id, MIN(source_rank) AS first_rank
        FROM unnest(v_raw_source_ids) WITH ORDINALITY AS source(source_id, source_rank)
        GROUP BY source_id
    ) configured;
    IF COALESCE(array_length(v_configured_source_ids, 1), 0) = 0 THEN
        RAISE EXCEPTION 'guest_inventory_source_unavailable';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM unnest(v_configured_source_ids) AS configured(source_id)
        LEFT JOIN public.shop_product_skus source_sku ON source_sku.id = configured.source_id
        WHERE source_sku.id IS NULL
           OR source_sku.product_id IS DISTINCT FROM v_product.id
           OR COALESCE(source_sku.is_active, false) IS NOT TRUE
           OR COALESCE(source_sku.manual_delivery, false)
    ) THEN
        RAISE EXCEPTION 'guest_inventory_source_invalid';
    END IF;

    -- Resolve the site-specific source chain and lock source SKUs in priority
    -- order. The resolver enforces same-product aliases and default semantics.
    -- Prove both directions: cardinality alone accepts two different source
    -- sets of equal length, which could reserve inventory from a stale alias.
    SELECT COALESCE(array_agg(src.source_sku_id ORDER BY src.source_rank), ARRAY[]::UUID[])
    INTO v_source_ids
    FROM public.fn_resolve_shop_sku_inventory_sources(v_sku.id, v_site) src;
    IF COALESCE(array_length(v_source_ids, 1), 0) = 0
       OR COALESCE(array_length(v_source_ids, 1), 0)
          <> COALESCE(array_length(v_configured_source_ids, 1), 0)
       OR EXISTS (
           SELECT 1
           FROM unnest(v_configured_source_ids) AS configured(source_id)
           WHERE NOT EXISTS (
               SELECT 1
               FROM unnest(v_source_ids) AS resolved(source_id)
               WHERE resolved.source_id = configured.source_id
           )
       )
       OR EXISTS (
           SELECT 1
           FROM unnest(v_source_ids) AS resolved(source_id)
           WHERE NOT EXISTS (
               SELECT 1
               FROM unnest(v_configured_source_ids) AS configured(source_id)
               WHERE configured.source_id = resolved.source_id
           )
       )
       -- Preserve first-occurrence priority too: it decides which available
       -- inventory row is held when several source pools have stock.
       OR v_source_ids IS DISTINCT FROM v_configured_source_ids THEN
        RAISE EXCEPTION 'guest_inventory_source_invalid';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.shop_product_skus source_sku
        WHERE source_sku.id = ANY(v_source_ids)
          AND (
              source_sku.product_id IS DISTINCT FROM v_product.id
              OR COALESCE(source_sku.is_active, false) IS NOT TRUE
              OR COALESCE(source_sku.manual_delivery, false)
          )
    ) THEN
        RAISE EXCEPTION 'guest_inventory_source_invalid';
    END IF;
    FOR v_source_sku IN
        SELECT s.*
        FROM public.shop_product_skus s
        WHERE s.id = ANY(v_source_ids)
        ORDER BY array_position(v_source_ids, s.id)
        FOR UPDATE
    LOOP
        NULL;
    END LOOP;

    v_guest_enabled := COALESCE(v_sku.allow_guest_purchase, v_product.allow_guest_purchase, false);
    IF v_guest_enabled IS NOT TRUE THEN
        RAISE EXCEPTION 'guest_purchase_disabled';
    END IF;

    v_unit_amount := public.guest_shop_resolve_credit_unit_amount(
        v_site,
        v_sku.price_points,
        v_sku.price_points_intl,
        COALESCE(v_sku.is_default, false),
        v_sku.quantity_rules,
        v_sku.quantity_rules_intl,
        v_product.quantity_rules,
        v_product.quantity_rules_intl,
        v_product.flash_sale_price,
        v_product.flash_sale_price_intl,
        v_product.flash_sale_end,
        v_product.flash_sale_end_intl,
        1,
        v_now
    );
    IF v_unit_amount IS NULL
       OR LOWER(v_unit_amount::TEXT) IN ('nan', 'infinity', '-infinity')
       OR v_unit_amount <= 0
       OR v_unit_amount <> ROUND(v_unit_amount, 2) THEN
        RAISE EXCEPTION 'guest_credit_price_unavailable';
    END IF;
    v_unit_amount := ROUND(v_unit_amount, 2);

    v_allowed_channels := COALESCE(v_sku.guest_payment_channels, v_product.guest_payment_channels, '[]'::JSONB);
    -- Payment channel configuration is an allowlist, never an opt-out.  An
    -- empty/malformed list must fail closed, and each entry must be a string
    -- token or an explicit provider:channel pair.  Never accept mock/test/fake
    -- values through configuration even if an operator accidentally stores
    -- them in JSONB.
    IF jsonb_typeof(v_allowed_channels) <> 'array'
       OR jsonb_array_length(v_allowed_channels) = 0 THEN
        RAISE EXCEPTION 'guest_payment_channel_allowlist_empty';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_allowed_channels) AS allowed(value)
        WHERE jsonb_typeof(allowed.value) <> 'string'
           OR LOWER(BTRIM(allowed.value #>> '{}')) !~ '^[a-z0-9][a-z0-9._:-]{0,159}$'
           OR LOWER(BTRIM(allowed.value #>> '{}')) IN ('mock', 'test', 'fake')
    ) THEN
        RAISE EXCEPTION 'guest_payment_channel_allowlist_invalid';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(v_allowed_channels) AS allowed(channel)
        WHERE LOWER(BTRIM(allowed.channel)) IN (
            v_channel,
            v_provider,
            v_provider || ':' || v_channel
        )
    ) THEN
        RAISE EXCEPTION 'guest_payment_channel_unavailable';
    END IF;

    v_expires_at := v_now + make_interval(secs => p_ttl_seconds);

    -- P0 intentionally sells one row only and excludes reusable/shared rows.
    WITH source_rows AS MATERIALIZED (
        SELECT src.source_sku_id, src.source_is_default, src.source_rank
        FROM public.fn_resolve_shop_sku_inventory_sources(v_sku.id, v_site) src
    ), candidate AS (
        -- Carry the logical source selected by the same row-locking query.
        -- This is an immutable reservation snapshot; resolving the chain a
        -- second time after UPDATE would permit a concurrent configuration
        -- change (or a different default source) to mislabel the held row.
        SELECT i.id,
               src.source_sku_id AS matched_source_sku_id
        FROM public.shop_inventory i
        JOIN source_rows src
          ON i.sku_id = src.source_sku_id
          OR (src.source_is_default AND i.sku_id IS NULL)
        WHERE i.product_id = p_product_id
          AND i.status = 'available'
          AND COALESCE(i.is_shared, false) = false
        ORDER BY src.source_rank ASC, i.created_at ASC, i.id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.shop_inventory AS i
    SET status = 'reserve'
    FROM candidate
    WHERE i.id = candidate.id
      AND i.status = 'available'
    RETURNING i.id, candidate.matched_source_sku_id
    INTO v_inventory_id, v_inventory_source_sku_id;

    IF v_inventory_id IS NULL THEN
        RAISE EXCEPTION 'guest_inventory_unavailable';
    END IF;
    -- Default inventory rows intentionally have NULL i.sku_id; the candidate
    -- source carried above preserves which logical source authorized them.
    IF v_inventory_source_sku_id IS NULL THEN
        RAISE EXCEPTION 'guest_inventory_source_snapshot_failed';
    END IF;

    v_order_no := 'GS' || to_char(v_now, 'YYYYMMDDHH24MISSMS')
        || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 12));
    v_order_id := gen_random_uuid();
    v_payment_order_id := gen_random_uuid();

    INSERT INTO public.guest_shop_orders (
        id, order_no, idempotency_key, request_fingerprint, source_channel,
        site, currency, product_id, sku_id, snapshot_product_name,
        snapshot_sku_name, snapshot_delivery_type, snapshot_manual_delivery,
        snapshot_sku_manual_delivery, quantity, unit_amount, total_amount, payment_status,
        reservation_status, fulfillment_status, refund_status, claim_secret_hash,
        claim_secret_version, buyer_contact_hash, request_ip_hash,
        request_device_hash, expires_at, metadata
    ) VALUES (
        v_order_id, v_order_no, v_key, v_fingerprint, 'website_guest',
        v_site, v_currency, v_product.id, v_sku.id,
        COALESCE(NULLIF(BTRIM(v_product.name), ''), 'Product'),
        COALESCE(NULLIF(BTRIM(v_sku.sku_name), ''), 'Default'),
        v_delivery_type, COALESCE(v_product.manual_delivery, false),
        COALESCE(v_sku.manual_delivery, false),
        1, v_unit_amount, v_unit_amount, 'pending', 'held', 'pending', 'none',
        p_claim_secret_hash, 1, p_buyer_contact_hash, p_request_ip_hash,
        p_request_device_hash, v_expires_at, '{}'::JSONB
    );

    INSERT INTO public.guest_shop_inventory_reservations (
        id, order_id, inventory_id, inventory_source_sku_id, product_id, sku_id, site, status,
        reserved_at, reserved_until
    ) VALUES (
        gen_random_uuid(), v_order_id, v_inventory_id, v_inventory_source_sku_id,
        v_product.id, v_sku.id,
        v_site, 'held', v_now, v_expires_at
    );

    INSERT INTO public.guest_shop_payment_orders (
        id, guest_order_id, merchant_order_no, purpose, provider, channel,
        site, currency, expected_amount, status, expires_at
    ) VALUES (
        v_payment_order_id, v_order_id, v_order_no, 'shop_direct', v_provider,
        v_channel, v_site, v_currency, v_unit_amount, 'pending', v_expires_at
    );

    RETURN QUERY SELECT
        v_order_id,
        v_order_no,
        v_payment_order_id,
        v_order_no,
        v_site,
        v_currency,
        v_unit_amount,
        v_unit_amount,
        v_expires_at,
        1::SMALLINT,
        'held'::TEXT,
        'pending'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guest_shop_create_order(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_create_order(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;
