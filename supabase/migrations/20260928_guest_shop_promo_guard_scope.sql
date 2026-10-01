-- Scope the existing 20260924 deferred C-D3/C-D4 safety guard to discounted
-- guest orders.
--
-- The active database contract is the function and trigger pair installed by
-- 20260924_guest_shop_promo_safety_gates.sql. The untracked 20260925 file is a
-- historical draft and must not be used as a prerequisite: it introduces a
-- policy table that is not part of the deployed schema. This migration keeps
-- the existing hard-coded 20% / 2-order safety limits and only adds the missing
-- promo scope, so ordinary list-price orders can use their available stock.
--
-- Codex does not execute migrations. Apply this file after
-- 20260924_guest_shop_promo_safety_gates.sql, then run the existing read-only
-- verify query in a controlled database session.

CREATE OR REPLACE FUNCTION public.fn_guest_shop_enforce_promo_safety_gates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
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
       OR v_order.payment_status NOT IN ('pending', 'created', 'review')
       OR v_order.reservation_status <> 'held'
       OR v_order.expires_at <= clock_timestamp()
       OR (
           NULLIF(BTRIM(COALESCE(v_order.discount_code, '')), '') IS NULL
           AND COALESCE(v_order.discount_amount, 0) <= 0
       ) THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
        'guest-promo-guard:' || v_order.site || ':' || v_order.product_id::TEXT,
        0
    ));

    v_identity_contact := NULLIF(BTRIM(COALESCE(v_order.buyer_contact_hash, '')), '');
    v_identity_ip := NULLIF(BTRIM(COALESCE(v_order.request_ip_hash, '')), '');

    IF v_identity_contact IS NOT NULL AND v_identity_ip IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('guest-promo-contact:' || v_identity_contact, 0));
        PERFORM pg_advisory_xact_lock(hashtextextended('guest-promo-ip:' || v_identity_ip, 0));
    ELSIF v_identity_contact IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('guest-promo-contact:' || v_identity_contact, 0));
    ELSIF v_identity_ip IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('guest-promo-ip:' || v_identity_ip, 0));
    END IF;

    IF v_identity_contact IS NOT NULL OR v_identity_ip IS NOT NULL THEN
        SELECT COUNT(DISTINCT o.id)
        INTO v_open
        FROM public.guest_shop_orders o
        WHERE o.source_channel = 'website_guest'
          AND o.payment_status = 'pending'
          AND o.reservation_status = 'held'
          AND o.expires_at > clock_timestamp()
          AND (
              NULLIF(BTRIM(COALESCE(o.discount_code, '')), '') IS NOT NULL
              OR COALESCE(o.discount_amount, 0) > 0
          )
          AND (
              (v_identity_contact IS NOT NULL AND o.buyer_contact_hash = v_identity_contact)
              OR (v_identity_ip IS NOT NULL AND o.request_ip_hash = v_identity_ip)
          );
        IF v_open > 2 THEN
            RAISE EXCEPTION 'guest_open_orders_limit';
        END IF;
    END IF;

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
      AND (
          NULLIF(BTRIM(COALESCE(o.discount_code, '')), '') IS NOT NULL
          OR COALESCE(o.discount_amount, 0) > 0
      )
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
           >= 20 / 100::NUMERIC THEN
        RAISE EXCEPTION 'guest_stock_hold_limit';
    END IF;

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guest_shop_enforce_promo_safety_gates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_enforce_promo_safety_gates() TO service_role;

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

COMMENT ON FUNCTION public.fn_guest_shop_enforce_promo_safety_gates() IS
    'Deferred C-D3/C-D4 guest safety gate scoped to discounted orders. Ordinary list-price orders are excluded; discounted orders are serialised by product and contact/IP and checked against the logical source-chain hold ratio.';
