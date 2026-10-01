-- Return a guest promo reservation to the redemption row's own Asia/Shanghai
-- budget day, and release held stock before a successful refund returns the
-- coupon. Apply this after 20260923_guest_shop_promo_l1l2.sql,
-- 20260923_guest_shop_refund_state_hardening.sql, and the 20260924 through
-- 20260927 guest-shop migrations. Those later migrations do not replace these
-- three functions, so CREATE OR REPLACE updates an already-applied database
-- without rolling back unrelated function bodies.
--
-- This file does not enable guest products, guest SKUs, promotion, flash
-- sales, tier pricing, multi-item checkout, or INTL payments. It does not
-- recreate the manual-review refund trigger. Codex does not execute this
-- file; the operator applies it in the target database.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_guest_shop_return_discount_reservation(
    p_order_id UUID,
    p_reason TEXT DEFAULT 'order_expired'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_row RECORD;
    v_reason TEXT := LEFT(COALESCE(NULLIF(BTRIM(p_reason), ''), 'order_expired'), 120);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_claimed INTEGER := 0;
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;

    -- Idempotency claim. Only the caller that flips returned_at from NULL to a
    -- timestamp proceeds; every later call finds no row and returns false, so a
    -- double sweep cannot decrement used_count or the daily budget twice.
    FOR v_row IN
        UPDATE public.guest_shop_discount_redemptions
        SET returned_at = v_now,
            return_reason = v_reason
        WHERE order_id = p_order_id
          AND returned_at IS NULL
        RETURNING code, discount_amount, site, created_at
    LOOP
        -- Give back the shared counter and both guest counters. GREATEST(0, ...) is
        -- a floor, not a licence: the CHECK in §3.1 already forbids a negative or
        -- over-cap value, and this function only ever subtracts what §5 added.
        UPDATE public.discount_codes AS d
        SET used_count = GREATEST(0, COALESCE(d.used_count, 0) - 1),
            guest_used_count = GREATEST(0, COALESCE(d.guest_used_count, 0) - 1),
            guest_discount_total = GREATEST(0, COALESCE(d.guest_discount_total, 0) - v_row.discount_amount)
        WHERE d.code = v_row.code;

        -- Return the money to the redemption row's own Asia/Shanghai budget day,
        -- taken from guest_shop_discount_redemptions.created_at. A sweep that runs
        -- after midnight must not move that spend onto the new calendar day.
        UPDATE public.guest_shop_promo_budget AS b
        SET spent_cny = GREATEST(0, COALESCE(b.spent_cny, 0) - v_row.discount_amount),
            updated_at = v_now
        WHERE b.site = v_row.site
          AND b.budget_date = (v_row.created_at AT TIME ZONE 'Asia/Shanghai')::DATE;

        v_claimed := v_claimed + 1;
    END LOOP;

    RETURN v_claimed > 0;
END;
$$;

COMMENT ON FUNCTION public.fn_guest_shop_return_discount_reservation(UUID, TEXT) IS
    'Idempotently returns the usage counters and the daily budget reserved by one guest order''s discount code. The budget row is the redemption''s own Asia/Shanghai calendar day, taken from guest_shop_discount_redemptions.created_at, not the day the return runs. Call on expiry, cancellation and refund. Returns true only for the call that actually claimed the ledger row. service_role only.';

REVOKE ALL ON FUNCTION public.fn_guest_shop_return_discount_reservation(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_return_discount_reservation(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.guest_shop_release_held_reservations(
    p_order_id UUID,
    p_reason TEXT DEFAULT 'paid_order_partial_stock_loss'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_row RECORD;
    v_inventory_status TEXT;
    v_inventory_shared BOOLEAN;
    v_reason TEXT := LEFT(COALESCE(NULLIF(BTRIM(p_reason), ''), 'paid_order_partial_stock_loss'), 120);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_released INTEGER := 0;
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;

    FOR v_row IN
        SELECT r.id AS reservation_id, r.inventory_id AS inventory_id
        FROM public.guest_shop_inventory_reservations r
        WHERE r.order_id = p_order_id
          AND r.status = 'held'
        ORDER BY r.created_at ASC, r.id ASC
        FOR UPDATE
    LOOP
        SELECT i.status, COALESCE(i.is_shared, false)
        INTO v_inventory_status, v_inventory_shared
        FROM public.shop_inventory i
        WHERE i.id = v_row.inventory_id
        FOR UPDATE;

        IF FOUND AND v_inventory_status = 'reserve' AND NOT v_inventory_shared THEN
            UPDATE public.shop_inventory
            SET status = 'available'
            WHERE id = v_row.inventory_id
              AND status = 'reserve'
              AND COALESCE(is_shared, false) = false;
        END IF;

        UPDATE public.guest_shop_inventory_reservations
        SET status = 'released',
            released_at = COALESCE(released_at, v_now),
            release_reason = v_reason,
            updated_at = v_now
        WHERE id = v_row.reservation_id
          AND order_id = p_order_id
          AND status = 'held';
        IF FOUND THEN
            v_released := v_released + 1;
        END IF;
    END LOOP;

    -- C-C5 / C-D6: an order whose stock is being handed back is an order that
    -- will not deliver, so the marketing让利 it reserved must go back to the
    -- code quota and to that redemption row's own Asia/Shanghai budget day. The call is idempotent (it claims the
    -- ledger row), so invoking it here AND from fn_guest_shop_release_reservation
    -- AND from a later manual refund can never return the same budget twice.
    PERFORM public.fn_guest_shop_return_discount_reservation(p_order_id, v_reason);

    RETURN v_released;
END;
$$;

COMMENT ON FUNCTION public.guest_shop_release_held_reservations(UUID, TEXT) IS
    'Releases every held reservation of one guest order and returns its stock. service_role only.';

-- 7.1 fn_guest_shop_confirm_payment: aggregate over the reservation set.

REVOKE ALL ON FUNCTION public.guest_shop_release_held_reservations(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_release_held_reservations(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_guest_shop_record_refund_result(
    p_order_id UUID,
    p_refund_status TEXT,
    p_provider_ref TEXT DEFAULT NULL,
    p_error_code TEXT DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL
)
RETURNS TABLE (
    order_id UUID,
    refund_status TEXT,
    payment_status TEXT,
    fulfillment_status TEXT,
    provider_ref TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    v_payment public.guest_shop_payment_orders%ROWTYPE;
    v_status TEXT := LOWER(BTRIM(COALESCE(p_refund_status, '')));
    v_message TEXT := LEFT(NULLIF(BTRIM(COALESCE(p_error_message, '')), ''), 500);
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;
    IF v_status NOT IN ('pending', 'succeeded', 'failed', 'manual_review') THEN
        RAISE EXCEPTION 'guest_invalid_refund_status';
    END IF;
    IF v_status = 'succeeded' AND NULLIF(BTRIM(COALESCE(p_provider_ref, '')), '') IS NULL THEN
        RAISE EXCEPTION 'guest_refund_provider_ref_required';
    END IF;

    SELECT * INTO v_order
    FROM public.guest_shop_orders
    WHERE id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_order_not_found';
    END IF;
    SELECT * INTO v_payment
    FROM public.guest_shop_payment_orders
    WHERE guest_order_id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_payment_order_not_found';
    END IF;
    IF v_order.payment_status NOT IN ('confirmed', 'refunded', 'chargeback')
       AND v_order.fulfillment_status <> 'paid_unfulfillable' THEN
        RAISE EXCEPTION 'guest_refund_not_applicable';
    END IF;
    IF v_order.payment_status = 'chargeback'
       OR v_payment.status = 'chargeback' THEN
        RETURN QUERY SELECT v_order.id, v_order.refund_status,
                            v_order.payment_status, v_order.fulfillment_status,
                            v_payment.refund_provider_ref;
        RETURN;
    END IF;
    IF v_order.payment_status = 'refunded'
       AND v_status <> 'succeeded' THEN
        RETURN QUERY SELECT v_order.id, v_order.refund_status,
                            v_order.payment_status, v_order.fulfillment_status,
                            v_payment.refund_provider_ref;
        RETURN;
    END IF;

    -- Refund/chargeback is terminal. A repeated provider result may be
    -- acknowledged, but it must not move a succeeded refund backwards.
    IF v_order.refund_status = 'succeeded' AND v_status <> 'succeeded' THEN
        RETURN QUERY SELECT v_order.id, v_order.refund_status,
                            v_order.payment_status, v_order.fulfillment_status,
                            v_payment.refund_provider_ref;
        RETURN;
    END IF;

    IF v_status = 'succeeded' THEN
        IF v_order.refund_status = 'succeeded' THEN
            RETURN QUERY SELECT v_order.id, v_order.refund_status,
                                v_order.payment_status, v_order.fulfillment_status,
                                v_payment.refund_provider_ref;
            RETURN;
        END IF;
        UPDATE public.guest_shop_payment_orders
        SET status = 'refunded',
            refund_provider_ref = COALESCE(refund_provider_ref, LEFT(NULLIF(BTRIM(p_provider_ref), ''), 200)),
            last_error_code = NULL,
            last_error_message = NULL,
            updated_at = clock_timestamp()
        WHERE id = v_payment.id;
        UPDATE public.guest_shop_orders
        SET payment_status = 'refunded',
            refund_status = 'succeeded',
            fulfillment_status = CASE
                -- foundation CHECK requires fulfilled_at to imply delivered;
                -- retain delivered after refund while financial columns carry
                -- the refund terminal state.
                WHEN v_order.fulfillment_status = 'delivered' THEN 'delivered'
                WHEN v_order.fulfillment_status IN ('paid_unfulfillable', 'failed', 'dead_letter') THEN 'refunded'
                ELSE v_order.fulfillment_status
            END,
            last_error_code = NULL,
            last_error_message = NULL,
            updated_at = clock_timestamp()
        WHERE id = p_order_id;

        -- A successful refund reverses the coupon usage and the redemption-day
        -- guest-promo budget exactly once, after held stock is released. The
        -- helper claims the ledger row via returned_at IS NULL, so webhook and
        -- worker retries are harmless.
        PERFORM public.guest_shop_release_held_reservations(p_order_id, 'refund_succeeded');
        PERFORM public.fn_guest_shop_return_discount_reservation(
            p_order_id,
            'refund_succeeded'
        );
    ELSE
        UPDATE public.guest_shop_payment_orders
        SET status = CASE WHEN v_status = 'manual_review' THEN 'review' ELSE status END,
            refund_provider_ref = COALESCE(LEFT(NULLIF(BTRIM(p_provider_ref), ''), 200), refund_provider_ref),
            last_error_code = LEFT(NULLIF(BTRIM(COALESCE(p_error_code, '')), ''), 120),
            last_error_message = v_message,
            updated_at = clock_timestamp()
        WHERE id = v_payment.id;
        UPDATE public.guest_shop_orders
        SET refund_status = v_status,
            last_error_code = LEFT(NULLIF(BTRIM(COALESCE(p_error_code, '')), ''), 120),
            last_error_message = v_message,
            updated_at = clock_timestamp()
        WHERE id = p_order_id;
    END IF;

    RETURN QUERY
    SELECT o.id, o.refund_status, o.payment_status, o.fulfillment_status,
           p.refund_provider_ref
    FROM public.guest_shop_orders o
    JOIN public.guest_shop_payment_orders p ON p.guest_order_id = o.id
    WHERE o.id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guest_shop_record_refund_result(UUID, TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_record_refund_result(UUID, TEXT, TEXT, TEXT, TEXT)
    TO service_role;

COMMIT;
