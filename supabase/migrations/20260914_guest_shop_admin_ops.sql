-- Guest shop admin write-path RPCs.
-- Codex does not execute this file. Run it in the target Supabase SQL editor
-- only after Stage C code/tests are complete. This migration is additive: it
-- does not DROP tables, does not rollback 20260913, and does not enable guest
-- products.
--
-- Write operations remain service_role-only. The HTTP handler supplies RBAC,
-- confirm, reason, and audit. These RPCs never return inventory content,
-- claim hashes, or recovery codes.

CREATE OR REPLACE FUNCTION public.guest_shop_has_active_worker_lease(
    p_metadata JSONB,
    p_now TIMESTAMPTZ DEFAULT clock_timestamp()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_state JSONB := COALESCE(p_metadata -> '__guest_shop_worker', '{}'::JSONB);
    v_kind TEXT;
    v_token TEXT;
    v_expires TIMESTAMPTZ;
BEGIN
    FOREACH v_kind IN ARRAY ARRAY['fulfillment', 'refund']::TEXT[]
    LOOP
        v_token := NULLIF(BTRIM(COALESCE(v_state ->> (v_kind || '_lease_token'), '')), '');
        BEGIN
            v_expires := NULLIF(BTRIM(COALESCE(v_state ->> (v_kind || '_lease_expires_at'), '')), '')::TIMESTAMPTZ;
        EXCEPTION WHEN OTHERS THEN
            v_expires := NULL;
        END;
        IF v_token IS NOT NULL AND v_expires IS NOT NULL AND v_expires > p_now THEN
            RETURN TRUE;
        END IF;
    END LOOP;
    RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_shop_normalize_admin_reason(p_reason TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_reason TEXT := LEFT(BTRIM(COALESCE(p_reason, '')), 500);
BEGIN
    IF char_length(v_reason) < 8 THEN
        RAISE EXCEPTION 'guest_admin_reason_required';
    END IF;
    RETURN v_reason;
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_shop_merge_admin_action_metadata(
    p_metadata JSONB,
    p_action TEXT,
    p_reason TEXT,
    p_admin_id UUID,
    p_extra JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_metadata JSONB := COALESCE(p_metadata, '{}'::JSONB);
    v_admin JSONB := COALESCE(v_metadata -> '__guest_shop_admin', '{}'::JSONB);
BEGIN
    v_admin := v_admin || jsonb_build_object(
        'last_action', LEFT(BTRIM(COALESCE(p_action, '')), 64),
        'reason', LEFT(BTRIM(COALESCE(p_reason, '')), 500),
        'admin_id', p_admin_id,
        'acted_at', (clock_timestamp() AT TIME ZONE 'utc')
    );
    IF p_extra IS NOT NULL AND p_extra <> '{}'::JSONB THEN
        v_admin := v_admin || p_extra;
    END IF;
    RETURN v_metadata || jsonb_build_object('__guest_shop_admin', v_admin);
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

COMMENT ON FUNCTION public.fn_guest_shop_admin_queue_refund(UUID, TEXT, UUID, TEXT) IS
    'Queue a paid guest order for worker refund. Stores operator reason in metadata; never returns secrets.';
COMMENT ON FUNCTION public.fn_guest_shop_admin_unlock_dead_letter(UUID, TEXT, UUID, TEXT) IS
    'Single-order dead-letter unlock. Requires no active worker lease; resets attempts so the worker can retry.';
COMMENT ON FUNCTION public.fn_guest_shop_admin_manual_fulfill(UUID, TEXT, UUID, TEXT) IS
    'Atomically consume a replacement non-shared available inventory row for a paid_unfulfillable guest order. Does not return content.';

REVOKE ALL ON FUNCTION public.guest_shop_has_active_worker_lease(JSONB, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_has_active_worker_lease(JSONB, TIMESTAMPTZ) TO service_role;
REVOKE ALL ON FUNCTION public.guest_shop_normalize_admin_reason(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_normalize_admin_reason(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.guest_shop_merge_admin_action_metadata(JSONB, TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_merge_admin_action_metadata(JSONB, TEXT, TEXT, UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_admin_queue_refund(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_admin_queue_refund(UUID, TEXT, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_admin_unlock_dead_letter(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_admin_unlock_dead_letter(UUID, TEXT, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_admin_manual_fulfill(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_admin_manual_fulfill(UUID, TEXT, UUID, TEXT) TO service_role;
