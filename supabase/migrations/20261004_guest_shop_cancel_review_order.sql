-- Allow buyer cancellation for unpaid guest orders in review state (e.g. payment_creation_unknown).
--
-- When a payment creation fails or network drops before provider confirmation,
-- the order enters 'review' status with held inventory reservations.
-- Buyers must be able to cancel or discard these unpaid orders safely,
-- releasing held inventory and marking the order expired.

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

    IF (v_order.payment_status NOT IN ('pending', 'review'))
       OR (v_payment.status NOT IN ('pending', 'created', 'review'))
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
    'Cancels an unpaid guest order (including review/creation_unknown), expires its payment intent, and releases held stock atomically.';

REVOKE ALL ON FUNCTION public.fn_guest_shop_cancel_order(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_cancel_order(UUID, TEXT) TO service_role;

-- Also support checkout batch cancellation for unpaid review batches
CREATE OR REPLACE FUNCTION public.fn_guest_shop_cancel_checkout_batch(
    p_batch_id UUID, p_reason TEXT DEFAULT 'buyer_cancelled'
)
RETURNS TABLE(cancelled BOOLEAN, batch_id UUID, released_count INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $cancel$
DECLARE
    v_batch public.guest_shop_checkout_batches%ROWTYPE;
    v_payment public.guest_shop_checkout_payments%ROWTYPE;
    v_released INTEGER;
    v_reason TEXT := LEFT(COALESCE(NULLIF(BTRIM(p_reason), ''), 'buyer_cancelled'), 120);
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_batch_id IS NULL THEN RAISE EXCEPTION 'guest_checkout_batch_required'; END IF;
    SELECT * INTO v_payment FROM public.guest_shop_checkout_payments
    WHERE guest_shop_checkout_payments.batch_id = p_batch_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'guest_checkout_batch_not_found'; END IF;
    SELECT * INTO v_batch FROM public.guest_shop_checkout_batches
    WHERE id = p_batch_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'guest_checkout_batch_not_found'; END IF;
    IF v_batch.payment_status = 'expired'
       AND v_batch.last_error_code = 'guest_checkout_batch_cancelled' THEN
        RETURN QUERY SELECT true, v_batch.id, 0;
        RETURN;
    END IF;
    IF (v_batch.payment_status NOT IN ('pending', 'review'))
       OR (v_payment.status NOT IN ('pending', 'created', 'review'))
       OR v_batch.fulfillment_status <> 'pending'
       OR v_batch.refund_status <> 'none'
       OR EXISTS (SELECT 1 FROM public.guest_shop_checkout_reservations r
                  WHERE r.batch_id = v_batch.id AND r.status = 'consumed') THEN
        RAISE EXCEPTION 'guest_checkout_batch_not_cancellable';
    END IF;
    v_released := public.guest_shop_release_checkout_batch_reservations(v_batch.id, v_reason);
    UPDATE public.guest_shop_checkout_payments
    SET status = 'expired', last_error_code = 'guest_checkout_batch_cancelled',
        last_error_message = 'buyer cancelled the unpaid checkout batch', updated_at = v_now
    WHERE id = v_payment.id;
    UPDATE public.guest_shop_checkout_batches
    SET payment_status = 'expired', last_error_code = 'guest_checkout_batch_cancelled',
        last_error_message = 'buyer cancelled the unpaid checkout batch', updated_at = v_now
    WHERE id = v_batch.id;
    RETURN QUERY SELECT true, v_batch.id, v_released;
END;
$cancel$;

COMMENT ON FUNCTION public.fn_guest_shop_cancel_checkout_batch(UUID, TEXT) IS
    'Cancels an unpaid guest checkout batch (including review state) and releases held reservations atomically.';

REVOKE ALL ON FUNCTION public.fn_guest_shop_cancel_checkout_batch(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_cancel_checkout_batch(UUID, TEXT) TO service_role;
