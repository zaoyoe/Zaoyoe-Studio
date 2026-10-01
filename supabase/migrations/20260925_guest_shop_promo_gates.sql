-- Guest Shop promo safety gates (C-D3 / C-D4 / C-D5).
--
-- This migration is intentionally additive and does not execute any SQL in the
-- application. Apply it after 20260923_guest_shop_promo_l1l2.sql. The order RPC
-- remains the pricing/identity authority; these database guards are the final
-- transaction-level backstop when a caller, retry, or future code path bypasses
-- the HTTP checks.
--
-- C-D3: at most max_stock_hold_percent of a logical SKU/source-chain's usable
-- stock may be held by guest orders. C-D4: one contact/IP identity may have at
-- most max_open_orders pending, held orders. C-D5: a discounted order and all
-- of its reservations use the shorter promo TTL, regardless of the caller's
-- ordinary order TTL. All three checks are fail-closed and use deferred
-- constraint triggers so the order + reservations are validated as one unit.

CREATE TABLE IF NOT EXISTS public.guest_shop_promo_policy (
    id                       SMALLINT PRIMARY KEY DEFAULT 1,
    max_stock_hold_percent   NUMERIC(5,2) NOT NULL DEFAULT 20,
    max_open_orders          INTEGER NOT NULL DEFAULT 2,
    promo_order_ttl_seconds  INTEGER NOT NULL DEFAULT 600,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT guest_shop_promo_policy_singleton_check CHECK (id = 1),
    CONSTRAINT guest_shop_promo_policy_stock_percent_check
        CHECK (max_stock_hold_percent > 0 AND max_stock_hold_percent <= 100),
    CONSTRAINT guest_shop_promo_policy_open_orders_check
        CHECK (max_open_orders >= 1 AND max_open_orders <= 100),
    CONSTRAINT guest_shop_promo_policy_ttl_check
        CHECK (promo_order_ttl_seconds >= 300 AND promo_order_ttl_seconds <= 1800)
);

-- Defaults are deliberately active. GUEST_SHOP_MAX_QUANTITY may not be raised
-- above one until these database controls and their evidence are deployed.
INSERT INTO public.guest_shop_promo_policy (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.guest_shop_promo_policy IS
    'Singleton fail-closed guest-promo safety policy. C-D3 stock hold ratio, C-D4 open-order ceiling, and C-D5 promo TTL. Service-role only.';
COMMENT ON COLUMN public.guest_shop_promo_policy.max_stock_hold_percent IS
    'Maximum guest-held / (guest-held + available) logical source-chain stock percentage. Default 20.';
COMMENT ON COLUMN public.guest_shop_promo_policy.max_open_orders IS
    'Maximum pending+held guest orders matched by contact_hash or request_ip_hash. Default 2.';
COMMENT ON COLUMN public.guest_shop_promo_policy.promo_order_ttl_seconds IS
    'Short TTL for orders carrying a non-empty discount_code. Default 600 seconds; ordinary orders keep their caller TTL.';

ALTER TABLE public.guest_shop_promo_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guest_shop_promo_policy FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.guest_shop_promo_policy TO service_role;

CREATE INDEX IF NOT EXISTS idx_guest_shop_orders_guest_open_contact
    ON public.guest_shop_orders (buyer_contact_hash, expires_at)
    WHERE source_channel = 'website_guest'
      AND payment_status = 'pending'
      AND reservation_status = 'held';

CREATE INDEX IF NOT EXISTS idx_guest_shop_orders_guest_open_ip
    ON public.guest_shop_orders (request_ip_hash, expires_at)
    WHERE source_channel = 'website_guest'
      AND payment_status = 'pending'
      AND reservation_status = 'held';

CREATE INDEX IF NOT EXISTS idx_guest_shop_reservations_guest_hold_source
    ON public.guest_shop_inventory_reservations
        (product_id, site, inventory_source_sku_id, reserved_until)
    WHERE status = 'held';

-- C-D5. Clamp the order expiry before it is written. This keeps retries and
-- direct service-role callers on the same persisted deadline as the HTTP path.
CREATE OR REPLACE FUNCTION public.fn_guest_shop_promo_order_ttl_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_ttl INTEGER;
BEGIN
    IF NULLIF(BTRIM(COALESCE(NEW.discount_code, '')), '') IS NULL
       AND COALESCE(NEW.discount_amount, 0) <= 0 THEN
        RETURN NEW;
    END IF;

    SELECT p.promo_order_ttl_seconds
    INTO v_ttl
    FROM public.guest_shop_promo_policy p
    WHERE p.id = 1;

    IF NOT FOUND OR v_ttl IS NULL OR v_ttl < 300 OR v_ttl > 1800
       OR NEW.created_at IS NULL OR NEW.expires_at IS NULL THEN
        RAISE EXCEPTION 'guest_promo_order_ttl_invalid';
    END IF;

    NEW.expires_at := LEAST(
        NEW.expires_at,
        NEW.created_at + make_interval(secs => v_ttl)
    );
    IF NEW.expires_at <= NEW.created_at THEN
        RAISE EXCEPTION 'guest_promo_order_ttl_invalid';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guest_shop_promo_order_ttl_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_promo_order_ttl_guard() TO service_role;

DROP TRIGGER IF EXISTS trg_guest_shop_promo_order_ttl ON public.guest_shop_orders;
CREATE TRIGGER trg_guest_shop_promo_order_ttl
BEFORE INSERT OR UPDATE OF discount_code, discount_amount, created_at, expires_at
ON public.guest_shop_orders
FOR EACH ROW
EXECUTE FUNCTION public.fn_guest_shop_promo_order_ttl_guard();

-- The RPC computes reservation expiry before the order row is inserted. Clamp
-- each reservation after the order exists, so the shorter deadline applies to
-- both rows even when the caller supplied the old 1800-second TTL.
CREATE OR REPLACE FUNCTION public.fn_guest_shop_promo_reservation_ttl_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
BEGIN
    SELECT o.* INTO v_order
    FROM public.guest_shop_orders o
    WHERE o.id = NEW.order_id;

    IF FOUND
       AND NULLIF(BTRIM(COALESCE(v_order.discount_code, '')), '') IS NOT NULL THEN
        NEW.reserved_until := LEAST(NEW.reserved_until, v_order.expires_at);
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guest_shop_promo_reservation_ttl_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_promo_reservation_ttl_guard() TO service_role;

DROP TRIGGER IF EXISTS trg_guest_shop_promo_reservation_ttl ON public.guest_shop_inventory_reservations;
CREATE TRIGGER trg_guest_shop_promo_reservation_ttl
BEFORE INSERT OR UPDATE OF order_id, reserved_until
ON public.guest_shop_inventory_reservations
FOR EACH ROW
EXECUTE FUNCTION public.fn_guest_shop_promo_reservation_ttl_guard();

-- C-D3/C-D4. This is a deferred constraint trigger rather than an immediate
-- trigger because fn_guest_shop_create_order writes the order and its N
-- reservations in separate statements. At commit, both rows are visible to the
-- check and a failure rolls back the whole transaction atomically.
CREATE OR REPLACE FUNCTION public.fn_guest_shop_promo_order_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    v_policy public.guest_shop_promo_policy%ROWTYPE;
    v_source_ids UUID[];
    v_source_default BOOLEAN;
    v_held BIGINT := 0;
    v_available BIGINT := 0;
    v_open BIGINT := 0;
    v_identity_contact TEXT;
    v_identity_ip TEXT;
BEGIN
    IF TG_TABLE_NAME = 'guest_shop_inventory_reservations' THEN
        IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
            SELECT o.* INTO v_order
            FROM public.guest_shop_orders o
            WHERE o.id = NEW.order_id;
        ELSE
            SELECT o.* INTO v_order
            FROM public.guest_shop_orders o
            WHERE o.id = OLD.order_id;
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        SELECT o.* INTO v_order
        FROM public.guest_shop_orders o
        WHERE o.id = OLD.id;
    ELSE
        v_order := NEW;
    END IF;

    IF v_order.id IS NULL
       OR v_order.source_channel <> 'website_guest'
       OR v_order.payment_status <> 'pending'
       OR v_order.reservation_status <> 'held'
       OR v_order.expires_at <= clock_timestamp() THEN
        RETURN NULL;
    END IF;

    SELECT p.* INTO v_policy
    FROM public.guest_shop_promo_policy p
    WHERE p.id = 1;
    IF NOT FOUND
       OR v_policy.max_stock_hold_percent IS NULL
       OR v_policy.max_stock_hold_percent <= 0
       OR v_policy.max_stock_hold_percent > 100
       OR v_policy.max_open_orders IS NULL
       OR v_policy.max_open_orders < 1 THEN
        RAISE EXCEPTION 'guest_promo_order_ttl_invalid';
    END IF;

    -- The product lock is shared by every source-chain alias of that product.
    -- It serialises the count with concurrent create-order transactions without
    -- depending on which source SKU happened to win the inventory race.
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'guest-promo-guard:' || v_order.site || ':' || v_order.product_id::TEXT,
        0
    ));

    v_identity_contact := NULLIF(BTRIM(COALESCE(v_order.buyer_contact_hash, '')), '');
    v_identity_ip := NULLIF(BTRIM(COALESCE(v_order.request_ip_hash, '')), '');

    -- Orders for one identity can target different products, so the product
    -- lock alone is insufficient for C-D4. Acquire contact before IP whenever
    -- both are present; every caller follows this same order.
    IF v_identity_contact IS NOT NULL AND v_identity_ip IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('guest-promo-contact:' || v_identity_contact, 0));
        PERFORM pg_advisory_xact_lock(hashtextextended('guest-promo-ip:' || v_identity_ip, 0));
    ELSIF v_identity_contact IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('guest-promo-contact:' || v_identity_contact, 0));
    ELSIF v_identity_ip IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('guest-promo-ip:' || v_identity_ip, 0));
    END IF;

    -- C-D4. Count the prospective order as well; therefore the comparison is
    -- > max_open_orders (equivalent to rejecting when the pre-insert count is
    -- already >= max_open_orders). OR makes contact/IP a union, and COUNT(DISTINCT)
    -- prevents one order matching both identities from being counted twice.
    IF v_identity_contact IS NOT NULL OR v_identity_ip IS NOT NULL THEN
        SELECT COUNT(DISTINCT o.id)
        INTO v_open
        FROM public.guest_shop_orders o
        WHERE o.source_channel = 'website_guest'
          AND o.payment_status = 'pending'
          AND o.reservation_status = 'held'
          AND o.expires_at > clock_timestamp()
          AND (
              (v_identity_contact IS NOT NULL AND o.buyer_contact_hash = v_identity_contact)
              OR (v_identity_ip IS NOT NULL AND o.request_ip_hash = v_identity_ip)
          );
        IF v_open > v_policy.max_open_orders THEN
            RAISE EXCEPTION 'guest_open_orders_limit';
        END IF;
    END IF;

    -- C-D3. Resolve the logical source chain, then count only non-shared stock
    -- that belongs to that chain. The denominator intentionally includes held
    -- plus available rows, so a SKU with no available stock is always blocked.
    SELECT COALESCE(array_agg(src.source_sku_id ORDER BY src.source_rank), ARRAY[]::UUID[]),
           COALESCE(bool_or(src.source_is_default), false)
    INTO v_source_ids, v_source_default
    FROM public.fn_resolve_shop_sku_inventory_sources(v_order.sku_id, v_order.site) src;

    SELECT COUNT(*)
    INTO v_held
    FROM public.guest_shop_inventory_reservations r
    JOIN public.guest_shop_orders o ON o.id = r.order_id
    WHERE o.source_channel = 'website_guest'
      AND o.product_id = v_order.product_id
      AND o.site = v_order.site
      AND r.product_id = v_order.product_id
      AND r.site = v_order.site
      AND r.status = 'held'
      AND r.reserved_until > clock_timestamp()
      AND r.inventory_source_sku_id = ANY(COALESCE(v_source_ids, ARRAY[]::UUID[]));

    SELECT COUNT(*)
    INTO v_available
    FROM public.shop_inventory i
    WHERE i.product_id = v_order.product_id
      AND i.status = 'available'
      AND COALESCE(i.is_shared, false) = false
      AND (
          i.sku_id = ANY(COALESCE(v_source_ids, ARRAY[]::UUID[]))
          OR (v_source_default AND i.sku_id IS NULL)
      );

    IF v_held > 0
       AND v_held + v_available > 0
       AND v_held::NUMERIC / (v_held + v_available)::NUMERIC
           >= v_policy.max_stock_hold_percent / 100::NUMERIC THEN
        RAISE EXCEPTION 'guest_stock_hold_limit';
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guest_shop_promo_order_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_promo_order_guard() TO service_role;

DROP TRIGGER IF EXISTS trg_guest_shop_promo_order_guard ON public.guest_shop_orders;
CREATE CONSTRAINT TRIGGER trg_guest_shop_promo_order_guard
AFTER INSERT OR UPDATE OF buyer_contact_hash, request_ip_hash, payment_status,
    reservation_status, expires_at, product_id, sku_id, site
ON public.guest_shop_orders
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.fn_guest_shop_promo_order_guard();

DROP TRIGGER IF EXISTS trg_guest_shop_promo_reservation_guard ON public.guest_shop_inventory_reservations;
CREATE CONSTRAINT TRIGGER trg_guest_shop_promo_reservation_guard
AFTER INSERT OR UPDATE OF status, reserved_until, order_id, product_id, sku_id, site
ON public.guest_shop_inventory_reservations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.fn_guest_shop_promo_order_guard();

COMMENT ON FUNCTION public.fn_guest_shop_promo_order_guard() IS
    'Deferred C-D3/C-D4 guest safety gate. Serialises by product, validates logical source-chain hold ratio and contact/IP open-order count at transaction commit, and raises neutral guest_* codes atomically.';
