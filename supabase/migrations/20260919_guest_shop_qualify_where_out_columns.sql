-- Qualify WHERE-clause OUT columns so RETURNS TABLE names are not
-- ambiguous. Codex does not execute this file. Run it in the target
-- Supabase SQL editor after 20260918. This migration is additive: it only
-- CREATE OR REPLACE existing functions, does not DROP tables, does not
-- CASCADE, does not rollback 20260913/14/15/16/17/18, and does not enable guest products.
--
-- 20260918 verified 6/6 PASS and fixed UPDATE SET CASE arms, but it did not
-- replace fn_guest_shop_mark_fulfilled. After an official unlock, the local
-- worker claimed D3-01, consumed inventory (reservation consumed / stock
-- sold), then mark_fulfilled aborted with PostgreSQL 42702
-- column reference order_id is ambiguous. RETURNS TABLE(order_id ...)
-- makes an unqualified WHERE order_id = p_order_id illegal. The worker
-- classified that SQLSTATE as non-retryable and re-dead-lettered the order.
-- This hotfix aliases those WHERE clauses in mark_fulfilled, queue_refund,
-- and admin_manual_fulfill.

CREATE OR REPLACE FUNCTION public.fn_guest_shop_mark_fulfilled(
    p_order_id UUID,
    p_reservation_id UUID DEFAULT NULL
)
RETURNS TABLE (
    fulfilled BOOLEAN,
    order_id UUID,
    reservation_id UUID,
    fulfillment_status TEXT,
    fulfilled_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    v_reservation public.guest_shop_inventory_reservations%ROWTYPE;
    v_inventory_status TEXT;
    v_fulfilled_at TIMESTAMPTZ;
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;

    SELECT * INTO v_order
    FROM public.guest_shop_orders
    WHERE id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_order_not_found';
    END IF;
    IF v_order.payment_status <> 'confirmed'
       OR v_order.payment_status IN ('refunded', 'chargeback')
       OR v_order.refund_status IN ('succeeded', 'manual_review')
       OR v_order.fulfillment_status IN ('paid_unfulfillable', 'refunded', 'dead_letter') THEN
        RAISE EXCEPTION 'guest_payment_not_confirmed';
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

    SELECT i.status INTO v_inventory_status
    FROM public.shop_inventory i
    WHERE i.id = v_reservation.inventory_id
    FOR UPDATE;
    IF NOT FOUND OR v_inventory_status <> 'sold' THEN
        RAISE EXCEPTION 'guest_inventory_not_sold';
    END IF;
    IF v_reservation.status NOT IN ('consumed') THEN
        RAISE EXCEPTION 'guest_reservation_not_consumed';
    END IF;

    IF v_order.fulfillment_status = 'delivered' THEN
        RETURN QUERY SELECT
            true,
            p_order_id,
            v_reservation.id,
            v_order.fulfillment_status,
            v_order.fulfilled_at;
        RETURN;
    END IF;

    v_fulfilled_at := COALESCE(v_order.fulfilled_at, clock_timestamp());
    UPDATE public.guest_shop_orders o
    SET fulfillment_status = 'delivered',
        fulfilled_at = v_fulfilled_at,
        updated_at = clock_timestamp()
    WHERE o.id = p_order_id
      AND o.payment_status = 'confirmed'
      AND o.fulfillment_status <> 'delivered';

    RETURN QUERY SELECT
        true,
        p_order_id,
        v_reservation.id,
        'delivered'::TEXT,
        v_fulfilled_at;
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
CREATE OR REPLACE FUNCTION public.fn_guest_shop_admin_manual_fulfill(
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
    reservation_status TEXT,
    inventory_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    v_reservation public.guest_shop_inventory_reservations%ROWTYPE;
    v_reason TEXT := public.guest_shop_normalize_admin_reason(p_reason);
    v_site TEXT := public.guest_shop_normalize_site(p_expected_site);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_inventory_id UUID;
    v_inventory_source_sku_id UUID;
    v_previous_inventory_id UUID;
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
    IF v_order.payment_status <> 'confirmed'
       OR v_order.fulfillment_status <> 'paid_unfulfillable'
       OR v_order.refund_status IN ('pending', 'succeeded', 'manual_review') THEN
        RAISE EXCEPTION 'guest_admin_not_eligible';
    END IF;
    IF COALESCE(v_order.snapshot_sku_manual_delivery, v_order.snapshot_manual_delivery, false) THEN
        RAISE EXCEPTION 'guest_admin_manual_delivery';
    END IF;
    IF v_order.quantity <> 1 THEN
        RAISE EXCEPTION 'guest_admin_quantity_unsupported';
    END IF;

    SELECT * INTO v_reservation
    FROM public.guest_shop_inventory_reservations r
    WHERE r.order_id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_reservation_not_found';
    END IF;
    v_previous_inventory_id := v_reservation.inventory_id;

    WITH source_rows AS MATERIALIZED (
        SELECT src.source_sku_id, src.source_is_default, src.source_rank
        FROM public.fn_resolve_shop_sku_inventory_sources(v_order.sku_id, v_order.site) src
    ), candidate AS (
        SELECT i.id,
               src.source_sku_id AS matched_source_sku_id
        FROM public.shop_inventory i
        JOIN source_rows src
          ON i.sku_id = src.source_sku_id
          OR (src.source_is_default AND i.sku_id IS NULL)
        WHERE i.product_id = v_order.product_id
          AND i.status = 'available'
          AND COALESCE(i.is_shared, false) = false
        ORDER BY src.source_rank ASC, i.created_at ASC, i.id ASC
        LIMIT 1
        FOR UPDATE OF i SKIP LOCKED
    )
    UPDATE public.shop_inventory AS i
    SET status = 'sold',
        sold_at = COALESCE(i.sold_at, v_now),
        buyer_id = NULL
    FROM candidate
    WHERE i.id = candidate.id
      AND i.status = 'available'
      AND COALESCE(i.is_shared, false) = false
    RETURNING i.id, candidate.matched_source_sku_id
    INTO v_inventory_id, v_inventory_source_sku_id;

    IF v_inventory_id IS NULL OR v_inventory_source_sku_id IS NULL THEN
        RAISE EXCEPTION 'guest_inventory_unavailable';
    END IF;

    UPDATE public.guest_shop_inventory_reservations r
    SET inventory_id = v_inventory_id,
        inventory_source_sku_id = v_inventory_source_sku_id,
        status = 'consumed',
        consumed_at = COALESCE(consumed_at, v_now),
        updated_at = v_now
    WHERE r.id = v_reservation.id
      AND r.order_id = p_order_id;

    UPDATE public.guest_shop_orders o
    SET reservation_status = 'consumed',
        fulfillment_status = 'delivered',
        fulfilled_at = COALESCE(fulfilled_at, v_now),
        last_error_code = NULL,
        last_error_message = NULL,
        metadata = public.guest_shop_merge_admin_action_metadata(
            metadata,
            'manual_fulfill',
            v_reason,
            p_admin_id,
            jsonb_build_object(
                'previous_inventory_id', v_previous_inventory_id,
                'previous_fulfillment_status', v_order.fulfillment_status,
                'previous_reservation_status', v_reservation.status
            )
        ),
        updated_at = v_now
    WHERE o.id = p_order_id
      AND o.payment_status = 'confirmed'
      AND o.fulfillment_status = 'paid_unfulfillable';

    RETURN QUERY
    SELECT o.id, o.order_no, o.payment_status, o.fulfillment_status,
           o.refund_status, o.reservation_status, v_inventory_id
    FROM public.guest_shop_orders o
    WHERE o.id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guest_shop_mark_fulfilled(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_mark_fulfilled(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_admin_queue_refund(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_admin_queue_refund(UUID, TEXT, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_admin_manual_fulfill(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_admin_manual_fulfill(UUID, TEXT, UUID, TEXT) TO service_role;
