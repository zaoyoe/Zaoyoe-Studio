-- Guest Shop admin manual fulfillment for L1 multi-quantity orders.
--
-- Codex does not execute this file. Run it in the target Supabase SQL editor
-- only after 20260923_guest_shop_promo_l1l2.sql and the admin-ops migrations,
-- then run 20260927_verify_guest_shop_admin_manual_fulfill_l1.sql.
--
-- The earlier admin RPC rejected quantity <> 1. L1 orders can contain multiple reservation rows, and a paid order can lose one or more held cards
-- before the worker claims them. This replacement keeps the original
-- signature/return type for PostgREST compatibility and makes the write
-- atomic across the whole reservation set:
--   * lock order, then every reservation in stable order;
--   * preserve already consumed sold/non-shared cards;
--   * replace only released (or still-held) rows with matching available
--     non-shared inventory, one row at a time;
--   * roll the whole transaction back on any stock shortfall;
--   * mark the order delivered only after every reservation is consumed.
--
-- The SQL return column inventory_id is retained because PostgreSQL cannot
-- change a function's OUT record type with CREATE OR REPLACE. It is returned
-- as NULL; the HTTP handler already strips this column and never returns card
-- content, claim secrets, recovery codes, or inventory identifiers.

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
    v_inventory public.shop_inventory%ROWTYPE;
    v_reason TEXT := public.guest_shop_normalize_admin_reason(p_reason);
    v_site TEXT := public.guest_shop_normalize_site(p_expected_site);
    v_now TIMESTAMPTZ := clock_timestamp();
    v_res_total INTEGER := 0;
    v_res_consumed INTEGER := 0;
    v_replacement_count INTEGER := 0;
    v_previous_inventory_ids UUID[] := ARRAY[]::UUID[];
    v_inventory_id UUID;
    v_inventory_source_sku_id UUID;
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;
    IF p_admin_id IS NULL THEN
        RAISE EXCEPTION 'guest_admin_actor_required';
    END IF;

    -- Lock order first. Every guest fulfillment path uses this order ->
    -- reservation -> inventory order, which serializes worker/admin races.
    SELECT * INTO v_order
    FROM public.guest_shop_orders o
    WHERE o.id = p_order_id
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
    IF v_order.quantity < 1 OR v_order.quantity > 99 THEN
        RAISE EXCEPTION 'guest_admin_quantity_unsupported';
    END IF;

    -- Lock the complete set before touching any inventory. A stable order is
    -- required both for deterministic audits and to prevent one-card retries
    -- from selecting a different reservation on every call.
    PERFORM 1
    FROM public.guest_shop_inventory_reservations r
    WHERE r.order_id = p_order_id
    ORDER BY r.created_at ASC, r.id ASC
    FOR UPDATE;

    SELECT COUNT(*)::INTEGER,
           COUNT(*) FILTER (WHERE r.status = 'consumed')::INTEGER
    INTO v_res_total, v_res_consumed
    FROM public.guest_shop_inventory_reservations r
    WHERE r.order_id = p_order_id;

    IF v_res_total = 0 THEN
        RAISE EXCEPTION 'guest_reservation_not_found';
    END IF;
    IF v_res_total <> v_order.quantity THEN
        RAISE EXCEPTION 'guest_reservation_count_mismatch';
    END IF;

    -- Re-read the locked rows in the same stable order. Existing consumed rows
    -- are verified in place and are never replaced. Released rows (the normal
    -- partial-stock-loss state) and still-held rows are the only rows eligible
    -- for replacement.
    FOR v_reservation IN
        SELECT r.*
        FROM public.guest_shop_inventory_reservations r
        WHERE r.order_id = p_order_id
        ORDER BY r.created_at ASC, r.id ASC
        FOR UPDATE
    LOOP
        v_previous_inventory_ids := array_append(
            v_previous_inventory_ids,
            v_reservation.inventory_id
        );

        IF v_reservation.status = 'consumed' THEN
            SELECT * INTO v_inventory
            FROM public.shop_inventory i
            WHERE i.id = v_reservation.inventory_id
            FOR UPDATE;
            IF NOT FOUND
               OR v_inventory.status <> 'sold'
               OR COALESCE(v_inventory.is_shared, false) THEN
                RAISE EXCEPTION 'guest_consumed_inventory_inconsistent';
            END IF;
            CONTINUE;
        END IF;

        IF v_reservation.status NOT IN ('released', 'held') THEN
            RAISE EXCEPTION 'guest_reservation_status_inconsistent';
        END IF;

        -- A held row still owns a reserve inventory row. Release that row only
        -- after locking it, then select a different card. If no replacement
        -- exists, the exception rolls the release back with the entire call.
        IF v_reservation.status = 'held' THEN
            SELECT * INTO v_inventory
            FROM public.shop_inventory i
            WHERE i.id = v_reservation.inventory_id
            FOR UPDATE;
            IF NOT FOUND
               OR v_inventory.status <> 'reserve'
               OR COALESCE(v_inventory.is_shared, false) THEN
                RAISE EXCEPTION 'guest_inventory_inconsistent';
            END IF;
            UPDATE public.shop_inventory AS i
            SET status = 'available'
            WHERE i.id = v_reservation.inventory_id
              AND i.status = 'reserve'
              AND COALESCE(i.is_shared, false) = false;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'guest_inventory_update_race';
            END IF;
        END IF;

        v_inventory_id := NULL;
        v_inventory_source_sku_id := NULL;
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

        UPDATE public.guest_shop_inventory_reservations AS r
        SET inventory_id = v_inventory_id,
            inventory_source_sku_id = v_inventory_source_sku_id,
            status = 'consumed',
            released_at = NULL,
            release_reason = NULL,
            consumed_at = COALESCE(r.consumed_at, v_now),
            updated_at = v_now
        WHERE r.id = v_reservation.id
          AND r.order_id = p_order_id
          AND r.status IN ('released', 'held');
        IF NOT FOUND THEN
            RAISE EXCEPTION 'guest_reservation_update_race';
        END IF;

        v_res_consumed := v_res_consumed + 1;
        v_replacement_count := v_replacement_count + 1;
    END LOOP;

    IF v_res_consumed <> v_res_total THEN
        RAISE EXCEPTION 'guest_reservation_not_consumed';
    END IF;

    UPDATE public.guest_shop_orders AS o
    SET reservation_status = 'consumed',
        fulfillment_status = 'delivered',
        fulfilled_at = COALESCE(o.fulfilled_at, v_now),
        last_error_code = NULL,
        last_error_message = NULL,
        metadata = public.guest_shop_merge_admin_action_metadata(
            o.metadata,
            'manual_fulfill',
            v_reason,
            p_admin_id,
            jsonb_build_object(
                'replacement_count', v_replacement_count,
                'previous_inventory_ids', to_jsonb(v_previous_inventory_ids),
                'previous_fulfillment_status', v_order.fulfillment_status,
                'previous_reservation_status', v_order.reservation_status,
                'quantity', v_order.quantity
            )
        ),
        updated_at = v_now
    WHERE o.id = p_order_id
      AND o.payment_status = 'confirmed'
      AND o.fulfillment_status = 'paid_unfulfillable';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_admin_not_eligible';
    END IF;

    RETURN QUERY
    SELECT o.id, o.order_no, o.payment_status, o.fulfillment_status,
           o.refund_status, o.reservation_status, NULL::UUID
    FROM public.guest_shop_orders AS o
    WHERE o.id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guest_shop_admin_manual_fulfill(UUID, TEXT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_admin_manual_fulfill(UUID, TEXT, UUID, TEXT)
    TO service_role;

COMMENT ON FUNCTION public.fn_guest_shop_admin_manual_fulfill(UUID, TEXT, UUID, TEXT) IS
    'Atomic L1 admin fulfillment: preserve consumed cards and replace all missing reservations before delivery.';
