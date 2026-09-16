-- Qualify SET-clause right-hand status columns so RETURNS TABLE names are
-- not ambiguous. Codex does not execute this file. Run it in the target
-- Supabase SQL editor after 20260917. This migration is additive: it only
-- CREATE OR REPLACE existing functions, does not DROP tables, does not
-- CASCADE, does not rollback 20260913/14/15/16/17, and does not enable guest products.
--
-- 20260917 made RETURN QUERY use table aliases and verified 4/4 PASS, but
-- that was not enough. PostgreSQL 42702 still fires when a SET-clause CASE
-- reads the same status column names that RETURNS TABLE declares. After an
-- equivalent unlock, the production worker claimed the D3-01 order, hit
-- that UPDATE, rolled back, and re-dead-lettered it. This hotfix qualifies
-- those CASE expressions with v_order.<column>.

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
CREATE OR REPLACE FUNCTION public.fn_guest_shop_confirm_payment(
    p_payment_order_id UUID,
    p_event_id UUID DEFAULT NULL,
    p_provider TEXT DEFAULT NULL,
    p_provider_order_no TEXT DEFAULT NULL,
    p_observed_site TEXT DEFAULT NULL,
    p_observed_currency TEXT DEFAULT NULL,
    p_observed_amount NUMERIC DEFAULT NULL,
    p_observed_purpose TEXT DEFAULT NULL,
    p_observed_status TEXT DEFAULT NULL,
    p_signature_verified BOOLEAN DEFAULT false,
    p_amount_verified BOOLEAN DEFAULT false,
    p_currency_verified BOOLEAN DEFAULT false,
    p_final_status_verified BOOLEAN DEFAULT false
)
RETURNS TABLE (
    confirmed BOOLEAN,
    order_id UUID,
    payment_order_id UUID,
    payment_status TEXT,
    fulfillment_status TEXT,
    reservation_status TEXT,
    refund_status TEXT,
    event_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_id UUID;
    v_order public.guest_shop_orders%ROWTYPE;
    v_payment public.guest_shop_payment_orders%ROWTYPE;
    v_event public.guest_shop_payment_events%ROWTYPE;
    v_reservation public.guest_shop_inventory_reservations%ROWTYPE;
    v_inventory_status TEXT;
    v_inventory_shared BOOLEAN;
    v_provider TEXT := LOWER(BTRIM(COALESCE(p_provider, '')));
    v_provider_order_no TEXT := BTRIM(COALESCE(p_provider_order_no, ''));
    v_site TEXT := public.guest_shop_normalize_site(p_observed_site);
    v_currency TEXT := UPPER(BTRIM(COALESCE(p_observed_currency, '')));
    v_purpose TEXT := LOWER(BTRIM(COALESCE(p_observed_purpose, '')));
    v_status TEXT := LOWER(BTRIM(COALESCE(p_observed_status, '')));
    v_now TIMESTAMPTZ := clock_timestamp();
    v_event_status TEXT := 'processed';
    v_confirmed BOOLEAN := true;
    v_late_success BOOLEAN := false;
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_payment_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_payment_order_required';
    END IF;
    IF p_event_id IS NULL THEN
        RAISE EXCEPTION 'guest_payment_event_required';
    END IF;
    IF v_provider = '' OR char_length(v_provider) > 80
       OR v_provider !~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
       OR v_provider IN ('mock', 'test', 'fake') THEN
        RAISE EXCEPTION 'guest_invalid_payment_provider';
    END IF;
    IF v_provider_order_no = '' OR char_length(v_provider_order_no) > 300
       OR v_provider_order_no ~ '[[:cntrl:][:space:]]' THEN
        RAISE EXCEPTION 'guest_invalid_provider_order_no';
    END IF;
    IF v_site NOT IN ('cn', 'intl') THEN
        RAISE EXCEPTION 'guest_invalid_site';
    END IF;
    IF v_currency NOT IN ('CNY', 'USD') THEN
        RAISE EXCEPTION 'guest_invalid_currency';
    END IF;
    IF v_purpose <> 'shop_direct' THEN
        RAISE EXCEPTION 'guest_invalid_payment_purpose';
    END IF;
    IF p_observed_amount IS NULL
       OR LOWER(p_observed_amount::TEXT) IN ('nan', 'infinity', '-infinity')
       OR p_observed_amount < 0
       OR p_observed_amount > 999999999999.99
       OR p_observed_amount <> ROUND(p_observed_amount, 2) THEN
        RAISE EXCEPTION 'guest_invalid_payment_amount';
    END IF;
    IF p_signature_verified IS NOT TRUE
       OR p_amount_verified IS NOT TRUE
       OR p_currency_verified IS NOT TRUE
       OR p_final_status_verified IS NOT TRUE
       OR NOT public.guest_shop_payment_is_final_success(v_status) THEN
        RAISE EXCEPTION 'guest_payment_verification_required';
    END IF;

    -- Resolve the order before taking the payment lock.  All guest state
    -- transitions use order -> payment -> reservation -> inventory ordering.
    SELECT p.guest_order_id
    INTO v_order_id
    FROM public.guest_shop_payment_orders p
    WHERE p.id = p_payment_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_payment_order_not_found';
    END IF;

    SELECT * INTO v_order
    FROM public.guest_shop_orders o
    WHERE o.id = v_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_order_not_found';
    END IF;

    SELECT * INTO v_payment
    FROM public.guest_shop_payment_orders p
    WHERE p.id = p_payment_order_id
    FOR UPDATE;
    IF NOT FOUND OR v_payment.guest_order_id <> v_order.id THEN
        RAISE EXCEPTION 'guest_payment_order_mismatch';
    END IF;

    IF v_payment.provider <> v_provider
       OR v_payment.merchant_order_no <> v_order.order_no
       OR v_payment.purpose <> v_purpose
       OR v_payment.site <> v_site
       OR v_payment.currency <> v_currency
       OR v_payment.expected_amount <> p_observed_amount THEN
        RAISE EXCEPTION 'guest_payment_binding_mismatch';
    END IF;
    IF v_payment.provider_order_no IS NOT NULL
       AND v_payment.provider_order_no <> v_provider_order_no THEN
        RAISE EXCEPTION 'guest_provider_order_conflict';
    END IF;

    IF p_event_id IS NOT NULL THEN
        SELECT * INTO v_event
        FROM public.guest_shop_payment_events e
        WHERE e.id = p_event_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'guest_payment_event_not_found';
        END IF;
        IF v_event.payment_order_id IS DISTINCT FROM p_payment_order_id
           OR LOWER(BTRIM(v_event.provider)) <> v_provider
           OR v_event.provider_order_no IS DISTINCT FROM v_provider_order_no
           OR v_event.merchant_order_no IS DISTINCT FROM v_payment.merchant_order_no
           OR v_event.observed_site IS DISTINCT FROM v_site
           OR v_event.observed_currency IS DISTINCT FROM v_currency
           OR v_event.observed_amount IS DISTINCT FROM p_observed_amount
           OR v_event.observed_purpose IS DISTINCT FROM v_purpose
           OR LOWER(BTRIM(COALESCE(v_event.observed_status, ''))) <> v_status
           OR v_event.signature_verified IS NOT TRUE
           OR v_event.amount_verified IS NOT TRUE
           OR v_event.currency_verified IS NOT TRUE
           OR v_event.final_status_verified IS NOT TRUE THEN
            RAISE EXCEPTION 'guest_payment_event_binding_mismatch';
        END IF;

        -- A provider retry for the same event is a no-op.  The event is
        -- already bound to this payment and the state below is authoritative.
        IF v_event.processing_status IN ('processed', 'duplicate') THEN
            v_event_status := v_event.processing_status;
            RETURN QUERY
            SELECT
                v_payment.status = 'confirmed',
                v_order.id,
                v_payment.id,
                v_payment.status,
                v_order.fulfillment_status,
                v_order.reservation_status,
                v_order.refund_status,
                v_event_status;
            RETURN;
        END IF;
        IF v_event.processing_status IN ('rejected', 'dead_letter') THEN
            RAISE EXCEPTION 'guest_payment_event_not_processable';
        END IF;
        IF v_event.processing_status <> 'verified' THEN
            RAISE EXCEPTION 'guest_payment_event_not_verified';
        END IF;
    END IF;

    -- A refund/chargeback is terminal for fulfillment.  Mark the event as a
    -- duplicate rather than reviving a paid order or consuming stock again.
    IF v_payment.status IN ('refunded', 'chargeback')
       OR v_order.payment_status IN ('refunded', 'chargeback') THEN
        v_confirmed := false;
        v_event_status := 'duplicate';
        IF p_event_id IS NOT NULL THEN
            UPDATE public.guest_shop_payment_events
            SET processing_status = 'duplicate',
                processed_at = COALESCE(processed_at, v_now),
                updated_at = v_now
            WHERE id = p_event_id;
        END IF;
        RETURN QUERY
        SELECT v_confirmed, v_order.id, v_payment.id, v_payment.status,
               v_order.fulfillment_status, v_order.reservation_status,
               v_order.refund_status, v_event_status;
        RETURN;
    END IF;

    -- Bind the provider order number before setting confirmed.  The partial
    -- unique index on (provider, provider_order_no) rejects cross-order reuse.
    UPDATE public.guest_shop_payment_orders
    SET provider_order_no = v_provider_order_no,
        paid_amount = p_observed_amount,
        sign_verified = true,
        amount_verified = true,
        currency_verified = true,
        final_status_verified = true,
        status = 'confirmed',
        paid_at = COALESCE(paid_at, v_now),
        verified_at = COALESCE(verified_at, v_now),
        last_event_at = v_now,
        last_error_code = NULL,
        last_error_message = NULL,
        updated_at = v_now
    WHERE id = v_payment.id;

    SELECT * INTO v_reservation
    FROM public.guest_shop_inventory_reservations r
    WHERE r.order_id = v_order.id
    FOR UPDATE;
    v_late_success := NOT FOUND;

    -- Consumed is a terminal stock transition.  A retry that arrives after
    -- the order TTL must remain successful/idempotent and must never downgrade
    -- an already delivered order to paid_unfulfillable.
    IF NOT v_late_success AND v_reservation.status = 'consumed' THEN
        UPDATE public.guest_shop_orders
        SET payment_status = 'confirmed',
            paid_at = COALESCE(paid_at, v_now),
            reservation_status = 'consumed',
            updated_at = v_now
        WHERE id = v_order.id;
    ELSE
        IF NOT v_late_success
           AND (v_reservation.status = 'released' OR v_order.expires_at <= v_now) THEN
            v_late_success := true;
            IF v_reservation.status = 'held' THEN
                SELECT i.status, COALESCE(i.is_shared, false)
                INTO v_inventory_status, v_inventory_shared
                FROM public.shop_inventory i
                WHERE i.id = v_reservation.inventory_id
                FOR UPDATE;
                IF FOUND AND v_inventory_status = 'reserve' AND NOT v_inventory_shared THEN
                    UPDATE public.shop_inventory
                    SET status = 'available'
                    WHERE id = v_reservation.inventory_id
                      AND status = 'reserve'
                      AND COALESCE(is_shared, false) = false;
                END IF;
                UPDATE public.guest_shop_inventory_reservations
                SET status = 'released',
                    released_at = COALESCE(released_at, v_now),
                    release_reason = 'payment_confirmed_after_expiry',
                    updated_at = v_now
                WHERE id = v_reservation.id
                  AND status = 'held';
            END IF;
        ELSIF NOT v_late_success AND v_reservation.status = 'held' THEN
            SELECT i.status, COALESCE(i.is_shared, false)
            INTO v_inventory_status, v_inventory_shared
            FROM public.shop_inventory i
            WHERE i.id = v_reservation.inventory_id
            FOR UPDATE;
            IF NOT FOUND OR v_inventory_status <> 'reserve' OR v_inventory_shared THEN
                v_late_success := true;
                UPDATE public.guest_shop_inventory_reservations
                SET status = 'released',
                    released_at = COALESCE(released_at, v_now),
                    release_reason = 'payment_confirmed_inventory_not_reservable',
                    updated_at = v_now
                WHERE id = v_reservation.id
                  AND status = 'held';
            END IF;
        END IF;

        IF v_late_success THEN
            UPDATE public.guest_shop_orders
            SET payment_status = 'confirmed',
                paid_at = COALESCE(paid_at, v_now),
                reservation_status = CASE
                    WHEN v_reservation.id IS NULL THEN 'none'
                    ELSE 'released'
                END,
                fulfillment_status = CASE
                    WHEN v_order.fulfillment_status IN ('delivered', 'refunded') THEN v_order.fulfillment_status
                    ELSE 'paid_unfulfillable'
                END,
                refund_status = CASE
                    WHEN v_order.refund_status = 'succeeded' THEN v_order.refund_status
                    ELSE 'pending'
                END,
                last_error_code = CASE
                    WHEN v_order.fulfillment_status IN ('delivered', 'refunded') THEN last_error_code
                    ELSE 'paid_inventory_not_reservable'
                END,
                last_error_message = CASE
                    WHEN v_order.fulfillment_status IN ('delivered', 'refunded') THEN last_error_message
                    ELSE 'payment confirmed after reservation expiry or inventory loss'
                END,
                updated_at = v_now
            WHERE id = v_order.id;
        ELSE
            UPDATE public.guest_shop_orders
            SET payment_status = 'confirmed',
                paid_at = COALESCE(paid_at, v_now),
                updated_at = v_now
            WHERE id = v_order.id;
        END IF;
    END IF;

    IF p_event_id IS NOT NULL THEN
        UPDATE public.guest_shop_payment_events
        SET processing_status = 'processed',
            processed_at = COALESCE(processed_at, v_now),
            updated_at = v_now
        WHERE id = p_event_id;
    END IF;

    RETURN QUERY
    SELECT v_confirmed, o.id, p.id, p.status, o.fulfillment_status,
           o.reservation_status, o.refund_status,
           CASE WHEN p_event_id IS NULL THEN NULL ELSE v_event_status END
    FROM public.guest_shop_orders o
    JOIN public.guest_shop_payment_orders p ON p.guest_order_id = o.id
    WHERE o.id = v_order.id;
END;
$$;
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
CREATE OR REPLACE FUNCTION public.fn_guest_shop_admin_queue_refund(
    p_order_id UUID,
    p_reason TEXT,
    p_admin_id UUID,
    p_expected_site TEXT DEFAULT NULL
)
RETURNS TABLE (
    order_id UUID,
    order_no TEXT,
    payment_status TEXT,
    fulfillment_status TEXT,
    refund_status TEXT,
    reservation_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    v_reason TEXT := public.guest_shop_normalize_admin_reason(p_reason);
    v_site TEXT := public.guest_shop_normalize_site(p_expected_site);
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;
    IF p_admin_id IS NULL THEN
        RAISE EXCEPTION 'guest_admin_actor_required';
    END IF;

    SELECT * INTO v_order
    FROM public.guest_shop_orders
    WHERE id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_order_not_found';
    END IF;
    IF v_site NOT IN ('', 'all') AND v_order.site <> v_site THEN
        RAISE EXCEPTION 'guest_admin_site_mismatch';
    END IF;
    IF public.guest_shop_has_active_worker_lease(v_order.metadata, v_now) THEN
        RAISE EXCEPTION 'guest_admin_active_lease';
    END IF;
    IF v_order.payment_status IN ('refunded', 'chargeback')
       OR v_order.refund_status IN ('succeeded', 'manual_review') THEN
        RAISE EXCEPTION 'guest_admin_not_eligible';
    END IF;
    IF v_order.payment_status <> 'confirmed'
       AND v_order.fulfillment_status <> 'paid_unfulfillable' THEN
        RAISE EXCEPTION 'guest_admin_not_eligible';
    END IF;

    UPDATE public.guest_shop_orders o
    SET refund_status = CASE
            WHEN v_order.refund_status IN ('pending', 'failed') THEN v_order.refund_status
            ELSE 'pending'
        END,
        last_error_code = CASE
            WHEN v_order.refund_status = 'failed' THEN last_error_code
            ELSE NULL
        END,
        last_error_message = CASE
            WHEN v_order.refund_status = 'failed' THEN last_error_message
            ELSE NULL
        END,
        metadata = public.guest_shop_merge_admin_action_metadata(
            metadata,
            'request_refund',
            v_reason,
            p_admin_id,
            jsonb_build_object('previous_refund_status', v_order.refund_status)
        ),
        updated_at = v_now
    WHERE o.id = p_order_id
      AND o.refund_status NOT IN ('succeeded', 'manual_review');

    -- A first-time queue must become pending so the worker candidate query
    -- can pick the order even when fulfillment is delivered or dead_letter.
    UPDATE public.guest_shop_orders o
    SET refund_status = 'pending'
    WHERE o.id = p_order_id
      AND o.refund_status = 'none';

    RETURN QUERY
    SELECT o.id, o.order_no, o.payment_status, o.fulfillment_status,
           o.refund_status, o.reservation_status
    FROM public.guest_shop_orders o
    WHERE o.id = p_order_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.fn_guest_shop_admin_unlock_dead_letter(
    p_order_id UUID,
    p_reason TEXT,
    p_admin_id UUID,
    p_expected_site TEXT DEFAULT NULL
)
RETURNS TABLE (
    order_id UUID,
    order_no TEXT,
    payment_status TEXT,
    fulfillment_status TEXT,
    refund_status TEXT,
    reservation_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    v_reason TEXT := public.guest_shop_normalize_admin_reason(p_reason);
    v_site TEXT := public.guest_shop_normalize_site(p_expected_site);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_worker JSONB;
    v_worker_fulfillment TEXT;
    v_worker_refund TEXT;
    v_is_dead_letter BOOLEAN := false;
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;
    IF p_admin_id IS NULL THEN
        RAISE EXCEPTION 'guest_admin_actor_required';
    END IF;

    SELECT * INTO v_order
    FROM public.guest_shop_orders
    WHERE id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_order_not_found';
    END IF;
    IF v_site NOT IN ('', 'all') AND v_order.site <> v_site THEN
        RAISE EXCEPTION 'guest_admin_site_mismatch';
    END IF;
    IF public.guest_shop_has_active_worker_lease(v_order.metadata, v_now) THEN
        RAISE EXCEPTION 'guest_admin_active_lease';
    END IF;

    v_worker := COALESCE(v_order.metadata -> '__guest_shop_worker', '{}'::JSONB);
    v_worker_fulfillment := LOWER(BTRIM(COALESCE(v_worker ->> 'fulfillment_status', '')));
    v_worker_refund := LOWER(BTRIM(COALESCE(v_worker ->> 'refund_status', '')));
    v_is_dead_letter := v_order.fulfillment_status = 'dead_letter'
        OR v_worker_fulfillment = 'dead_letter'
        OR v_worker_refund = 'dead_letter';
    IF NOT v_is_dead_letter THEN
        RAISE EXCEPTION 'guest_admin_not_eligible';
    END IF;

    v_worker := v_worker || jsonb_build_object(
        'version', 1,
        'fulfillment_attempt_count', 0,
        'fulfillment_next_attempt_at', NULL,
        'fulfillment_lease_token', NULL,
        'fulfillment_lease_expires_at', NULL,
        'fulfillment_worker', NULL,
        'fulfillment_dead_lettered_at', NULL,
        'fulfillment_terminal', false,
        'fulfillment_status', 'retry_waiting',
        'refund_attempt_count', 0,
        'refund_next_attempt_at', NULL,
        'refund_lease_token', NULL,
        'refund_lease_expires_at', NULL,
        'refund_worker', NULL,
        'refund_dead_lettered_at', NULL,
        'refund_terminal', false,
        'refund_status', CASE
            WHEN v_order.refund_status IN ('pending', 'failed') THEN 'retry_waiting'
            ELSE 'none'
        END
    );

    UPDATE public.guest_shop_orders
    SET fulfillment_status = CASE
            WHEN v_order.fulfillment_status = 'dead_letter' THEN 'failed'
            ELSE v_order.fulfillment_status
        END,
        metadata = public.guest_shop_merge_admin_action_metadata(
            (COALESCE(metadata, '{}'::JSONB) || jsonb_build_object('__guest_shop_worker', v_worker)),
            'unlock_dead_letter',
            v_reason,
            p_admin_id,
            jsonb_build_object(
                'previous_fulfillment_status', v_order.fulfillment_status,
                'previous_worker_fulfillment_status', v_worker_fulfillment,
                'previous_worker_refund_status', v_worker_refund
            )
        ),
        updated_at = v_now
    WHERE id = p_order_id;

    RETURN QUERY
    SELECT o.id, o.order_no, o.payment_status, o.fulfillment_status,
           o.refund_status, o.reservation_status
    FROM public.guest_shop_orders o
    WHERE o.id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guest_shop_claim_fulfillment(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_claim_fulfillment(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_release_reservation(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_release_reservation(UUID, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_confirm_payment(UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_confirm_payment(UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_record_refund_result(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_record_refund_result(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_admin_queue_refund(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_admin_queue_refund(UUID, TEXT, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_admin_unlock_dead_letter(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_admin_unlock_dead_letter(UUID, TEXT, UUID, TEXT) TO service_role;
