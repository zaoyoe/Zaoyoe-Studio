-- Buyer cancellation for an unpaid guest checkout.
--
-- The browser must not release stock by deleting its local handle. This RPC
-- serializes against payment confirmation on the order row, returns every
-- still-held reservation (including any coupon ledger), and expires the bound
-- payment intent so the old payment code cannot be used to revive the order.

DO $cancel_check$
BEGIN
    IF to_regclass('public.guest_shop_orders') IS NULL
       OR to_regclass('public.guest_shop_payment_orders') IS NULL
       OR to_regclass('public.guest_shop_inventory_reservations') IS NULL
       OR to_regprocedure('public.guest_shop_release_held_reservations(uuid,text)') IS NULL THEN
        RAISE EXCEPTION 'guest shop cancel migration requires the guest shop foundation and release helper';
    END IF;
END;
$cancel_check$;

CREATE OR REPLACE FUNCTION public.fn_guest_shop_cancel_order(
    p_order_id UUID,
    p_reason TEXT DEFAULT 'buyer_cancelled'
)
RETURNS TABLE (
    cancelled BOOLEAN,
    order_id UUID,
    payment_status TEXT,
    reservation_status TEXT,
    fulfillment_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $cancel_rpc$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    v_payment public.guest_shop_payment_orders%ROWTYPE;
    v_reason TEXT := LEFT(COALESCE(NULLIF(BTRIM(p_reason), ''), 'buyer_cancelled'), 120);
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;

    -- Payment confirmation takes the same order lock first. Whichever action
    -- wins the lock is authoritative, so cancellation cannot race a webhook
    -- into releasing stock after payment has already been accepted.
    SELECT * INTO v_order
    FROM public.guest_shop_orders
    WHERE id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_order_not_found';
    END IF;

    SELECT * INTO v_payment
    FROM public.guest_shop_payment_orders
    WHERE guest_order_id = v_order.id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_payment_order_not_found';
    END IF;

    IF v_order.payment_status <> 'pending'
       OR v_payment.status NOT IN ('pending', 'created')
       OR v_order.fulfillment_status IN ('delivered', 'refunded', 'dead_letter', 'paid_unfulfillable')
       OR v_order.refund_status IN ('succeeded', 'manual_review')
       OR EXISTS (
           SELECT 1
           FROM public.guest_shop_inventory_reservations r
           WHERE r.order_id = v_order.id
             AND r.status = 'consumed'
       ) THEN
        RAISE EXCEPTION 'guest_order_not_cancellable';
    END IF;

    -- This helper locks and conditionally releases each non-shared inventory
    -- row, then returns the reserved discount ledger. It is idempotent, so a
    -- retry after a network timeout cannot double-release stock or budget.
    PERFORM public.guest_shop_release_held_reservations(v_order.id, v_reason);

    UPDATE public.guest_shop_payment_orders
    SET status = 'expired',
        last_error_code = 'guest_order_cancelled',
        last_error_message = 'buyer cancelled the unpaid guest order',
        updated_at = v_now
    WHERE id = v_payment.id;

    UPDATE public.guest_shop_orders
    SET payment_status = 'expired',
        reservation_status = public.guest_shop_reservation_rollup(v_order.id),
        cancelled_at = COALESCE(cancelled_at, v_now),
        last_error_code = 'guest_order_cancelled',
        last_error_message = 'buyer cancelled the unpaid guest order',
        updated_at = v_now
    WHERE id = v_order.id;

    RETURN QUERY
    SELECT true,
           o.id,
           o.payment_status,
           o.reservation_status,
           o.fulfillment_status
    FROM public.guest_shop_orders o
    WHERE o.id = v_order.id;
END;
$cancel_rpc$;

COMMENT ON FUNCTION public.fn_guest_shop_cancel_order(UUID, TEXT) IS
    'Cancels an unpaid guest order, expires its payment intent, and releases held stock atomically.';

REVOKE ALL ON FUNCTION public.fn_guest_shop_cancel_order(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_cancel_order(UUID, TEXT) TO service_role;

-- A provider callback that arrives after cancellation is intentionally handled
-- by the existing confirm state machine. With all reservations already
-- released, it takes the paid-unfulfillable path and queues a refund; it can
-- never consume inventory or mark the order delivered.
