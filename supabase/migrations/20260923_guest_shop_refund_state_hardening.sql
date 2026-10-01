-- Guest-shop refund and manual-review state hardening.
-- Apply after 20260923_guest_shop_promo_l1l2.sql. This additive migration does
-- not enable guest products, promotion, or multi-item checkout.
-- Codex does not execute this file; the operator applies it in the target DB.
BEGIN;

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

-- A later inventory/TTL rollup may request refund_status='pending' while an
-- operator has already sent this order to manual review. Keep that review state
-- while allowing unrelated order fields to finish updating. Explicit terminal
-- outcomes (succeeded/failed) remain writable through the refund RPC.
CREATE OR REPLACE FUNCTION public.guest_shop_preserve_refund_manual_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF OLD.refund_status = 'manual_review'
       AND NEW.refund_status = 'pending' THEN
        NEW.refund_status := 'manual_review';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guest_shop_preserve_refund_manual_review()
    FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guest_shop_preserve_refund_manual_review
    ON public.guest_shop_orders;
CREATE TRIGGER guest_shop_preserve_refund_manual_review
    BEFORE UPDATE OF refund_status ON public.guest_shop_orders
    FOR EACH ROW
    EXECUTE FUNCTION public.guest_shop_preserve_refund_manual_review();

COMMIT;
