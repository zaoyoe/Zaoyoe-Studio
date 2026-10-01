-- Fix batch cancellation/expiry for the current shop_inventory schema.
-- shop_inventory has created_at but intentionally has no updated_at column.
-- The original batch-cancel migration wrote that nonexistent column while
-- releasing held rows, so an unpaid batch could be left in place with a
-- generic "取消订单失败" response. Keep the release operation atomic and
-- idempotent; only remove the invalid touch column.

DO $batch_cancel_inventory_fix_check$
BEGIN
    IF to_regclass('public.guest_shop_checkout_reservations') IS NULL
       OR to_regclass('public.shop_inventory') IS NULL
       OR to_regprocedure('public.guest_shop_require_service_role()') IS NULL THEN
        RAISE EXCEPTION 'guest checkout batch cancel inventory fix requires the batch foundation';
    END IF;
END;
$batch_cancel_inventory_fix_check$;

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
    IF p_batch_id IS NULL THEN
        RAISE EXCEPTION 'guest_checkout_batch_required';
    END IF;

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

        -- shop_inventory has no updated_at column; status is the only field
        -- changed when a held item is released.
        UPDATE public.shop_inventory
           SET status = 'available'
         WHERE id = v_res.inventory_id AND status = 'reserve';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'guest_checkout_batch_reservation_inconsistent';
        END IF;

        UPDATE public.guest_shop_checkout_reservations
           SET status = 'released', released_at = clock_timestamp(),
               release_reason = LEFT(p_reason, 120), updated_at = clock_timestamp()
         WHERE id = v_res.id AND status = 'held';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'guest_checkout_batch_reservation_inconsistent';
        END IF;
        v_released := v_released + 1;
    END LOOP;
    RETURN v_released;
END;
$release$;

REVOKE ALL ON FUNCTION public.guest_shop_release_checkout_batch_reservations(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_release_checkout_batch_reservations(UUID, TEXT) TO service_role;
