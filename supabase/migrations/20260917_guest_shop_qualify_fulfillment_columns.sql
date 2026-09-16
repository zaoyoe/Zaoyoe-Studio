-- Qualify guest-shop RETURN QUERY columns so RETURNS TABLE names are not
-- ambiguous. Codex does not execute this file. Run it in the target Supabase
-- SQL editor after 20260913/14/15. This migration is additive: it only
-- CREATE OR REPLACE two existing functions, does not DROP tables, does not
-- CASCADE, does not rollback 20260913/14/15, and does not enable guest products.
--
-- D3-01 live Alipay ¥0.01 was confirmed, then fn_guest_shop_claim_fulfillment
-- aborted with PostgreSQL 42702 "column reference \"fulfillment_status\" is
-- ambiguous". RETURNS TABLE(fulfillment_status ...) makes an unqualified
-- `SELECT fulfillment_status FROM guest_shop_orders` illegal. The worker then
-- dead-lettered the order; inventory stayed reserve/held because the RPC
-- rolled back.

CREATE OR REPLACE FUNCTION public.fn_guest_shop_claim_fulfillment(
    p_order_id UUID,
    p_reservation_id UUID DEFAULT NULL
)
RETURNS TABLE (
    order_id UUID,
    reservation_id UUID,
    inventory_id UUID,
    content TEXT,
    fulfillment_status TEXT,
    reservation_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    v_reservation public.guest_shop_inventory_reservations%ROWTYPE;
    v_inventory public.shop_inventory%ROWTYPE;
    v_inventory_found BOOLEAN;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;

    SELECT * INTO v_order
    FROM public.guest_shop_orders o
    WHERE o.id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_order_not_found';
    END IF;
    IF v_order.payment_status <> 'confirmed'
       OR v_order.payment_status IN ('refunded', 'chargeback')
       OR v_order.refund_status IN ('succeeded', 'manual_review')
       OR v_order.fulfillment_status IN ('paid_unfulfillable', 'refunded', 'dead_letter') THEN
        RAISE EXCEPTION 'guest_payment_not_fulfillable';
    END IF;

    SELECT * INTO v_reservation
    FROM public.guest_shop_inventory_reservations r
    WHERE r.order_id = p_order_id
      AND (p_reservation_id IS NULL OR r.id = p_reservation_id)
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_reservation_not_found';
    END IF;
    IF p_reservation_id IS NOT NULL AND v_reservation.id <> p_reservation_id THEN
        RAISE EXCEPTION 'guest_reservation_order_mismatch';
    END IF;

    IF v_reservation.status = 'consumed' THEN
        SELECT * INTO v_inventory
        FROM public.shop_inventory i
        WHERE i.id = v_reservation.inventory_id
        FOR UPDATE;
        IF NOT FOUND OR v_inventory.status <> 'sold' OR COALESCE(v_inventory.is_shared, false) THEN
            RAISE EXCEPTION 'guest_consumed_inventory_inconsistent';
        END IF;
        RETURN QUERY SELECT
            v_order.id, v_reservation.id, v_inventory.id, v_inventory.content,
            v_order.fulfillment_status, v_reservation.status;
        RETURN;
    END IF;

    IF v_reservation.status <> 'held' THEN
        -- Released rows are terminal.  Do not try to find replacement stock.
        RETURN QUERY SELECT
            v_order.id, v_reservation.id, v_reservation.inventory_id, NULL::TEXT,
            v_order.fulfillment_status, v_reservation.status;
        RETURN;
    END IF;

    SELECT * INTO v_inventory
    FROM public.shop_inventory i
    WHERE i.id = v_reservation.inventory_id
    FOR UPDATE;

    v_inventory_found := FOUND;

    IF v_order.expires_at <= v_now
       OR v_reservation.reserved_until <= v_now
       OR NOT v_inventory_found
       OR (v_inventory_found AND (v_inventory.status <> 'reserve'
           OR COALESCE(v_inventory.is_shared, false))) THEN
        -- Do not raise after writing this state: an exception would roll the
        -- paid_unfulfillable marker back and make the refund queue blind.
        IF v_inventory_found AND v_inventory.status = 'reserve' AND NOT COALESCE(v_inventory.is_shared, false) THEN
            UPDATE public.shop_inventory
            SET status = 'available'
            WHERE id = v_inventory.id
              AND status = 'reserve'
              AND COALESCE(is_shared, false) = false;
        END IF;
        UPDATE public.guest_shop_inventory_reservations
        SET status = 'released',
            released_at = COALESCE(released_at, v_now),
            release_reason = CASE
                WHEN v_order.expires_at <= v_now OR v_reservation.reserved_until <= v_now
                    THEN 'paid_reservation_expired'
                ELSE 'paid_inventory_not_reservable'
            END,
            updated_at = v_now
        WHERE id = v_reservation.id
          AND status = 'held';
        UPDATE public.guest_shop_orders
        SET reservation_status = 'released',
            fulfillment_status = 'paid_unfulfillable',
            refund_status = CASE
                WHEN v_order.refund_status = 'succeeded' THEN v_order.refund_status
                ELSE 'pending'
            END,
            last_error_code = 'paid_inventory_not_reservable',
            last_error_message = 'payment confirmed but held inventory expired or was lost',
            updated_at = v_now
        WHERE id = v_order.id;
        RETURN QUERY SELECT
            v_order.id, v_reservation.id, v_reservation.inventory_id, NULL::TEXT,
            'paid_unfulfillable'::TEXT, 'released'::TEXT;
        RETURN;
    END IF;

    UPDATE public.shop_inventory
    SET status = 'sold',
        sold_at = COALESCE(sold_at, v_now),
        buyer_id = NULL
    WHERE id = v_inventory.id
      AND status = 'reserve'
      AND COALESCE(is_shared, false) = false;
    IF NOT FOUND THEN
        -- The row changed despite the lock only if an out-of-band trigger or
        -- manual operation violated the state contract.  Persist a visible
        -- compensation state rather than throwing it away in a rollback.
        UPDATE public.guest_shop_inventory_reservations
        SET status = 'released',
            released_at = COALESCE(released_at, v_now),
            release_reason = 'paid_inventory_update_race',
            updated_at = v_now
        WHERE id = v_reservation.id
          AND status = 'held';
        UPDATE public.guest_shop_orders
        SET reservation_status = 'released',
            fulfillment_status = 'paid_unfulfillable',
            refund_status = CASE WHEN v_order.refund_status = 'succeeded' THEN v_order.refund_status ELSE 'pending' END,
            last_error_code = 'paid_inventory_update_race',
            last_error_message = 'inventory could not be consumed after payment confirmation',
            updated_at = v_now
        WHERE id = v_order.id;
        RETURN QUERY SELECT
            v_order.id, v_reservation.id, v_reservation.inventory_id, NULL::TEXT,
            'paid_unfulfillable'::TEXT, 'released'::TEXT;
        RETURN;
    END IF;

    UPDATE public.guest_shop_inventory_reservations
    SET status = 'consumed',
        consumed_at = COALESCE(consumed_at, v_now),
        updated_at = v_now
    WHERE id = v_reservation.id
      AND status = 'held';
    IF NOT FOUND THEN
        -- This should be impossible under the reservation lock, but leave a
        -- compensatable state if a future trigger changes the row semantics.
        UPDATE public.guest_shop_orders
        SET fulfillment_status = 'paid_unfulfillable',
            refund_status = CASE WHEN v_order.refund_status = 'succeeded' THEN v_order.refund_status ELSE 'pending' END,
            last_error_code = 'guest_reservation_update_race',
            last_error_message = 'reservation could not be consumed after inventory sale',
            updated_at = v_now
        WHERE id = v_order.id;
        RETURN QUERY SELECT
            v_order.id, v_reservation.id, v_reservation.inventory_id, NULL::TEXT,
            'paid_unfulfillable'::TEXT, v_reservation.status;
        RETURN;
    END IF;

    UPDATE public.guest_shop_orders
    SET reservation_status = 'consumed',
        fulfillment_status = CASE
            WHEN v_order.fulfillment_status = 'delivered' THEN v_order.fulfillment_status
            ELSE 'fulfilling'
        END,
        updated_at = v_now
    WHERE id = v_order.id
      AND payment_status = 'confirmed';

    RETURN QUERY SELECT
        v_order.id, v_reservation.id, v_inventory.id, v_inventory.content,
        (SELECT o.fulfillment_status FROM public.guest_shop_orders o WHERE o.id = v_order.id),
        'consumed'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_guest_shop_release_reservation(
    p_reservation_id UUID,
    p_order_id UUID,
    p_reason TEXT DEFAULT 'expired'
)
RETURNS TABLE (
    released BOOLEAN,
    reservation_status TEXT,
    payment_status TEXT,
    fulfillment_status TEXT,
    refund_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    v_reservation public.guest_shop_inventory_reservations%ROWTYPE;
    v_inventory_status TEXT;
    v_released BOOLEAN := false;
    v_reason TEXT := LEFT(COALESCE(NULLIF(BTRIM(p_reason), ''), 'expired'), 120);
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_reservation_id IS NULL OR p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_reservation_and_order_required';
    END IF;

    -- State-transition functions consistently lock order -> reservation ->
    -- inventory, which prevents release/consume races from deadlocking.
    SELECT * INTO v_order
    FROM public.guest_shop_orders
    WHERE id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_order_not_found';
    END IF;

    SELECT * INTO v_reservation
    FROM public.guest_shop_inventory_reservations
    WHERE id = p_reservation_id
    FOR UPDATE;
    IF NOT FOUND OR v_reservation.order_id <> p_order_id THEN
        RAISE EXCEPTION 'guest_reservation_order_mismatch';
    END IF;

    IF v_reservation.status = 'held' THEN
        SELECT i.status INTO v_inventory_status
        FROM public.shop_inventory i
        WHERE i.id = v_reservation.inventory_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'guest_inventory_not_found';
        END IF;

        IF v_inventory_status = 'reserve' THEN
            UPDATE public.shop_inventory
            SET status = 'available'
            WHERE id = v_reservation.inventory_id
              AND status = 'reserve';
            v_released := true;
        END IF;

        UPDATE public.guest_shop_inventory_reservations
        SET status = 'released',
            released_at = clock_timestamp(),
            release_reason = v_reason,
            updated_at = clock_timestamp()
        WHERE id = v_reservation.id
          AND order_id = p_order_id
          AND status = 'held';

        IF v_order.payment_status = 'confirmed' THEN
            UPDATE public.guest_shop_orders
            SET reservation_status = 'released',
                fulfillment_status = 'paid_unfulfillable',
                refund_status = CASE
                    WHEN v_order.refund_status = 'succeeded' THEN v_order.refund_status
                    ELSE 'pending'
                END,
                last_error_code = CASE
                    WHEN v_released THEN last_error_code
                    ELSE 'paid_inventory_not_reservable'
                END,
                last_error_message = CASE
                    WHEN v_released THEN last_error_message
                    ELSE 'payment confirmed but inventory was not in reserve state'
                END,
                updated_at = clock_timestamp()
            WHERE id = p_order_id;
        ELSE
            UPDATE public.guest_shop_orders
            SET reservation_status = 'released',
                last_error_code = NULL,
                last_error_message = NULL,
                updated_at = clock_timestamp()
            WHERE id = p_order_id;
        END IF;
    ELSE
        -- Releasing an already released/consumed row is idempotent.  A consumed
        -- row is never rewound to available, even for a repeated expiry job.
        v_released := v_reservation.status = 'released';
    END IF;

    RETURN QUERY SELECT
        v_released,
        (SELECT r.status FROM public.guest_shop_inventory_reservations r WHERE r.id = p_reservation_id),
        (SELECT o.payment_status FROM public.guest_shop_orders o WHERE o.id = p_order_id),
        (SELECT o.fulfillment_status FROM public.guest_shop_orders o WHERE o.id = p_order_id),
        (SELECT o.refund_status FROM public.guest_shop_orders o WHERE o.id = p_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guest_shop_claim_fulfillment(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_claim_fulfillment(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_release_reservation(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_release_reservation(UUID, UUID, TEXT) TO service_role;
