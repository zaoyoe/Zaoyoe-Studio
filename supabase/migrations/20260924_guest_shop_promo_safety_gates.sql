-- Guest Shop Promo safety gates C-D3/C-D4/C-D5.
--
-- Codex does not execute this file. Apply it only after
-- 20260923_guest_shop_promo_l1l2.sql, then run the matching verify script.
-- The trigger is intentionally fail-closed and does not change any product,
-- SKU, quantity or promo switch. The existing defaults remain quantity=1 and
-- discount=off.
--
-- C-D3: a guest SKU may not hold >=20% of its source-chain stock.
-- C-D4: one contact hash or request IP may not hold more than 2 open guest orders.
-- C-D5: a discounted order may not reserve beyond 600 seconds.

DROP INDEX IF EXISTS public.idx_guest_shop_orders_open_contact_gate;
CREATE INDEX idx_guest_shop_orders_open_contact_gate
    ON public.guest_shop_orders (buyer_contact_hash, expires_at)
    WHERE source_channel = 'website_guest'
      AND payment_status IN ('pending', 'created', 'review')
      AND reservation_status = 'held';

DROP INDEX IF EXISTS public.idx_guest_shop_orders_open_ip_gate;
CREATE INDEX idx_guest_shop_orders_open_ip_gate
    ON public.guest_shop_orders (request_ip_hash, expires_at)
    WHERE source_channel = 'website_guest'
      AND payment_status IN ('pending', 'created', 'review')
      AND reservation_status = 'held';

DROP INDEX IF EXISTS public.idx_guest_shop_guest_reservations_stock_gate;
CREATE INDEX idx_guest_shop_guest_reservations_stock_gate
    ON public.guest_shop_inventory_reservations (product_id, inventory_source_sku_id, status);

CREATE OR REPLACE FUNCTION public.fn_guest_shop_enforce_promo_safety_gates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_open_contact INTEGER := 0;
    v_open_ip INTEGER := 0;
    v_held NUMERIC := 0;
    v_available NUMERIC := 0;
    v_total NUMERIC := 0;
    v_promo_deadline TIMESTAMPTZ;
BEGIN
    -- Guard both order and reservation writes. Deferred order events see the
    -- reservations written later in the same RPC transaction; reservation
    -- events also cover direct service-role writes and status changes.
    IF TG_TABLE_NAME = 'guest_shop_inventory_reservations' THEN
        SELECT o.*
        INTO v_order
        FROM public.guest_shop_orders o
        WHERE o.id = NEW.order_id;
    ELSE
        v_order := NEW;
    END IF;

    IF v_order.id IS NULL
       OR v_order.source_channel IS DISTINCT FROM 'website_guest' THEN
        RETURN NEW;
    END IF;

    -- C-D5 is repeated in the database because service-role callers can bypass
    -- the HTTP layer. The 600-second ceiling is hard; the app may only shorten
    -- it through GUEST_SHOP_PROMO_ORDER_TTL_SECONDS.
    IF (
           NULLIF(BTRIM(COALESCE(v_order.discount_code, '')), '') IS NOT NULL
           OR COALESCE(v_order.discount_amount, 0) > 0
       )
       AND (
           v_order.created_at IS NULL
           OR v_order.expires_at IS NULL
           OR v_order.expires_at > v_order.created_at + INTERVAL '600 seconds'
       ) THEN
        RAISE EXCEPTION 'guest_promo_order_ttl_invalid';
    END IF;

    IF NULLIF(BTRIM(COALESCE(v_order.discount_code, '')), '') IS NOT NULL
       OR COALESCE(v_order.discount_amount, 0) > 0 THEN
        v_promo_deadline := LEAST(
            v_order.expires_at,
            v_order.created_at + INTERVAL '600 seconds'
        );
        -- The order deadline alone is insufficient: a direct service-role
        -- caller could otherwise leave a reservation held beyond the order.
        IF EXISTS (
            SELECT 1
            FROM public.guest_shop_inventory_reservations r
            WHERE r.order_id = v_order.id
              AND (r.reserved_until IS NULL OR r.reserved_until > v_promo_deadline)
        ) THEN
            RAISE EXCEPTION 'guest_promo_order_ttl_invalid';
        END IF;
    END IF;

    IF v_order.payment_status IS NULL
       OR v_order.payment_status NOT IN ('pending', 'created', 'review')
       OR v_order.reservation_status IS DISTINCT FROM 'held'
       OR v_order.expires_at IS NULL
       OR v_order.expires_at <= v_now THEN
        RETURN NEW;
    END IF;

    -- Serialize every source-chain alias of a product. Physical inventory may
    -- be shared by CN and INTL, so the lock is not scoped to one site/SKU.
    PERFORM pg_advisory_xact_lock(hashtextextended(
        'guest-promo-stock:' || COALESCE(v_order.product_id::TEXT, ''),
        0
    ));
    IF v_order.buyer_contact_hash IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('guest-promo-contact:' || v_order.buyer_contact_hash, 0));
    END IF;
    IF v_order.request_ip_hash IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('guest-promo-ip:' || v_order.request_ip_hash, 0));
    END IF;

    -- C-D4: count existing live open orders, excluding the row currently being
    -- checked. Contact and IP limits are independent; either one is enough to
    -- reject the new order. The public mapper intentionally hides which fired.
    IF v_order.buyer_contact_hash IS NOT NULL THEN
        SELECT COUNT(*)
        INTO v_open_contact
        FROM public.guest_shop_orders o
        WHERE o.id <> v_order.id
          AND o.source_channel = 'website_guest'
          AND o.buyer_contact_hash = v_order.buyer_contact_hash
          AND o.payment_status IN ('pending', 'created', 'review')
          AND o.reservation_status = 'held'
          AND o.expires_at > v_now;
    END IF;
    IF v_order.request_ip_hash IS NOT NULL THEN
        SELECT COUNT(*)
        INTO v_open_ip
        FROM public.guest_shop_orders o
        WHERE o.id <> v_order.id
          AND o.source_channel = 'website_guest'
          AND o.request_ip_hash = v_order.request_ip_hash
          AND o.payment_status IN ('pending', 'created', 'review')
          AND o.reservation_status = 'held'
          AND o.expires_at > v_now;
    END IF;
    IF v_open_contact >= 2 OR v_open_ip >= 2 THEN
        RAISE EXCEPTION 'guest_open_orders_limit';
    END IF;

    -- C-D3: count every physically held guest reservation in the logical source
    -- chain. A stale row whose inventory is still `reserve` remains unavailable
    -- until the release worker repairs it, so it stays in the conservative
    -- numerator rather than allowing a second hold through the gate.
    SELECT COUNT(*)
    INTO v_held
    FROM public.guest_shop_inventory_reservations r
    JOIN public.guest_shop_orders o ON o.id = r.order_id
    JOIN public.shop_inventory i ON i.id = r.inventory_id
    WHERE o.product_id = v_order.product_id
      AND r.product_id = v_order.product_id
      AND r.status = 'held'
      AND o.source_channel = 'website_guest'
      AND i.status = 'reserve'
      AND COALESCE(i.is_shared, false) = false
      AND EXISTS (
          SELECT 1
          FROM public.fn_resolve_shop_sku_inventory_sources(v_order.sku_id, v_order.site) src
          WHERE src.source_sku_id = r.inventory_source_sku_id
      );

    SELECT COUNT(*)
    INTO v_available
    FROM public.shop_inventory i
    WHERE i.product_id = v_order.product_id
      AND i.status = 'available'
      AND COALESCE(i.is_shared, false) = false
      AND EXISTS (
          SELECT 1
          FROM public.fn_resolve_shop_sku_inventory_sources(v_order.sku_id, v_order.site) src
          WHERE src.source_sku_id = i.sku_id
             OR (src.source_is_default IS TRUE AND i.sku_id IS NULL)
      );

    v_total := v_held + v_available;
    IF v_total > 0 AND v_held * 100 >= v_total * 20 THEN
        RAISE EXCEPTION 'guest_stock_hold_limit';
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_guest_shop_enforce_promo_safety_gates() IS
    'Deferred guest promo safety gates: 20% stock hold ceiling, two open orders per contact/IP, and 600s promo TTL. service-role trigger only.';

DROP TRIGGER IF EXISTS guest_shop_promo_safety_gates ON public.guest_shop_orders;
CREATE CONSTRAINT TRIGGER guest_shop_promo_safety_gates
    AFTER INSERT OR UPDATE OF buyer_contact_hash, request_ip_hash, payment_status,
        reservation_status, expires_at, product_id, sku_id, site, discount_code,
        discount_amount
    ON public.guest_shop_orders
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_guest_shop_enforce_promo_safety_gates();

DROP TRIGGER IF EXISTS guest_shop_promo_safety_reservation_gates
    ON public.guest_shop_inventory_reservations;
CREATE CONSTRAINT TRIGGER guest_shop_promo_safety_reservation_gates
    AFTER INSERT OR UPDATE OF status, reserved_until, order_id, product_id, sku_id, site
    ON public.guest_shop_inventory_reservations
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_guest_shop_enforce_promo_safety_gates();

REVOKE ALL ON FUNCTION public.fn_guest_shop_enforce_promo_safety_gates() FROM PUBLIC, anon, authenticated;
