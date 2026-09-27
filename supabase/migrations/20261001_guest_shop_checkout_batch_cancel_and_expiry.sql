-- Cancel or expire an unpaid cart checkout as one locked payment and inventory transition.
-- The payment row is locked before the batch row, matching payment confirmation.

DO $batch_cancel_check$
BEGIN
    IF to_regclass('public.guest_shop_checkout_batches') IS NULL
       OR to_regclass('public.guest_shop_checkout_payments') IS NULL
       OR to_regclass('public.guest_shop_checkout_reservations') IS NULL
       OR to_regprocedure('public.guest_shop_require_service_role()') IS NULL THEN
        RAISE EXCEPTION 'guest checkout batch migration requires the batch foundation';
    END IF;
END;
$batch_cancel_check$;

CREATE OR REPLACE FUNCTION public.guest_shop_release_checkout_batch_reservations(
    p_batch_id UUID, p_reason TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $release$
DECLARE
    v_res RECORD;
    v_released INTEGER := 0;
BEGIN
    PERFORM public.guest_shop_require_service_role();
    FOR v_res IN
        SELECT r.id, r.inventory_id, i.status AS inventory_status, i.is_shared
        FROM public.guest_shop_checkout_reservations r
        JOIN public.shop_inventory i ON i.id = r.inventory_id
        WHERE r.batch_id = p_batch_id AND r.status = 'held'
        ORDER BY r.created_at, r.id
        FOR UPDATE OF r, i
    LOOP
        IF v_res.inventory_status <> 'reserve' OR COALESCE(v_res.is_shared, false) THEN
            RAISE EXCEPTION 'guest_checkout_batch_reservation_inconsistent';
        END IF;
        UPDATE public.shop_inventory
        SET status = 'available', updated_at = clock_timestamp()
        WHERE id = v_res.inventory_id AND status = 'reserve';
        IF NOT FOUND THEN RAISE EXCEPTION 'guest_checkout_batch_reservation_inconsistent'; END IF;
        UPDATE public.guest_shop_checkout_reservations
        SET status = 'released', released_at = clock_timestamp(),
            release_reason = LEFT(p_reason, 120), updated_at = clock_timestamp()
        WHERE id = v_res.id AND status = 'held';
        IF NOT FOUND THEN RAISE EXCEPTION 'guest_checkout_batch_reservation_inconsistent'; END IF;
        v_released := v_released + 1;
    END LOOP;
    RETURN v_released;
END;
$release$;

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
    IF v_batch.payment_status <> 'pending'
       OR v_payment.status NOT IN ('pending', 'created')
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

CREATE OR REPLACE FUNCTION public.fn_guest_shop_expire_checkout_batches(p_limit INTEGER DEFAULT 50)
RETURNS TABLE(processed_count INTEGER, released_count INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $expiry$
DECLARE
    v_payment RECORD;
    v_batch public.guest_shop_checkout_batches%ROWTYPE;
    v_processed INTEGER := 0;
    v_released INTEGER := 0;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    PERFORM public.guest_shop_require_service_role();
    FOR v_payment IN
        SELECT p.id, p.batch_id FROM public.guest_shop_checkout_payments p
        JOIN public.guest_shop_checkout_batches b ON b.id = p.batch_id
        WHERE p.status IN ('pending', 'created') AND b.payment_status = 'pending'
          AND b.expires_at <= v_now
        ORDER BY b.expires_at, p.id
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
        FOR UPDATE OF p SKIP LOCKED
    LOOP
        SELECT * INTO v_batch FROM public.guest_shop_checkout_batches
        WHERE id = v_payment.batch_id FOR UPDATE;
        IF v_batch.payment_status <> 'pending' THEN CONTINUE; END IF;
        v_released := v_released + public.guest_shop_release_checkout_batch_reservations(v_batch.id, 'expired');
        UPDATE public.guest_shop_checkout_payments
        SET status = 'expired', last_error_code = 'guest_checkout_batch_expired',
            updated_at = clock_timestamp() WHERE id = v_payment.id;
        UPDATE public.guest_shop_checkout_batches
        SET payment_status = 'expired', last_error_code = 'guest_checkout_batch_expired',
            updated_at = clock_timestamp() WHERE id = v_batch.id;
        v_processed := v_processed + 1;
    END LOOP;
    RETURN QUERY SELECT v_processed, v_released;
END;
$expiry$;

-- A provider may report a valid late payment after buyer cancellation or expiry.
-- Keep the payment auditable but forbid fulfilment against released inventory.
CREATE OR REPLACE FUNCTION public.guest_shop_guard_late_checkout_batch_payment()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $late$
BEGIN
    IF OLD.payment_status = 'expired' AND NEW.payment_status = 'confirmed' THEN
        NEW.fulfillment_status := 'paid_unfulfillable';
        NEW.refund_status := 'manual_review';
        NEW.last_error_code := 'guest_checkout_batch_late_payment';
        NEW.last_error_message := 'payment arrived after checkout batch expired';
    END IF;
    RETURN NEW;
END;
$late$;

DROP TRIGGER IF EXISTS trg_guest_shop_guard_late_checkout_batch_payment
    ON public.guest_shop_checkout_batches;
CREATE TRIGGER trg_guest_shop_guard_late_checkout_batch_payment
BEFORE UPDATE OF payment_status ON public.guest_shop_checkout_batches
FOR EACH ROW EXECUTE FUNCTION public.guest_shop_guard_late_checkout_batch_payment();

REVOKE ALL ON FUNCTION public.guest_shop_release_checkout_batch_reservations(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_release_checkout_batch_reservations(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_cancel_checkout_batch(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_cancel_checkout_batch(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_expire_checkout_batches(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_expire_checkout_batches(INTEGER) TO service_role;
