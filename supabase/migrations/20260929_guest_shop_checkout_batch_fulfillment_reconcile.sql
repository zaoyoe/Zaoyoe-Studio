-- Repair an idempotent batch claim that consumed every reservation before the
-- final batch status update committed.  This is intentionally a migration,
-- because the fix must run inside the same locked transaction as the claim.
-- Run manually in the SQL editor; it does not mark any new payment as paid.

CREATE OR REPLACE FUNCTION public.fn_guest_shop_claim_checkout_batch(p_batch_id UUID)
RETURNS TABLE (
    item_id UUID,
    item_index INTEGER,
    product_id UUID,
    sku_id UUID,
    product_name TEXT,
    sku_name TEXT,
    quantity INTEGER,
    content TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_batch public.guest_shop_checkout_batches%ROWTYPE;
    v_item RECORD;
    v_res RECORD;
    v_inv RECORD;
    v_count INTEGER;
    v_consumed INTEGER;
    v_invalid INTEGER;
BEGIN
    PERFORM public.guest_shop_require_service_role();
    SELECT * INTO v_batch
      FROM public.guest_shop_checkout_batches
     WHERE id = p_batch_id
     FOR UPDATE;
    IF NOT FOUND OR v_batch.payment_status <> 'confirmed' THEN
        RAISE EXCEPTION 'guest_payment_not_confirmed';
    END IF;
    IF v_batch.fulfillment_status = 'paid_unfulfillable' THEN
        RETURN;
    END IF;

    SELECT COUNT(*), COUNT(*) FILTER (WHERE r.status = 'consumed')
      INTO v_count, v_consumed
      FROM public.guest_shop_checkout_reservations r
     WHERE r.batch_id = p_batch_id;
    IF v_count = 0 THEN
        RAISE EXCEPTION 'guest_inventory_not_reservable';
    END IF;

    -- A previous attempt may have consumed every reservation and then lost the
    -- transaction after the inventory updates but before the batch update.
    -- Reconcile the durable state before returning the immutable card content.
    IF v_batch.fulfillment_status = 'delivered' OR v_consumed = v_count THEN
        FOR v_res IN
            SELECT r.*
              FROM public.guest_shop_checkout_reservations r
             WHERE r.batch_id = p_batch_id
             ORDER BY r.created_at, r.id
        LOOP
            SELECT * INTO v_inv
              FROM public.shop_inventory
             WHERE id = v_res.inventory_id
             FOR UPDATE;
            IF NOT FOUND OR v_res.status <> 'consumed'
               OR v_inv.status <> 'sold'
               OR COALESCE(v_inv.is_shared, false) THEN
                RAISE EXCEPTION 'guest_inventory_not_reservable';
            END IF;
            SELECT i.* INTO v_item
              FROM public.guest_shop_checkout_items i
             WHERE i.id = v_res.item_id;
            UPDATE public.guest_shop_checkout_items
               SET fulfillment_status = 'delivered',
                   delivered_at = COALESCE(delivered_at, clock_timestamp()),
                   updated_at = clock_timestamp()
             WHERE id = v_res.item_id
               AND fulfillment_status <> 'delivered';
            item_id := v_res.item_id;
            item_index := v_item.item_index;
            product_id := v_item.product_id;
            sku_id := v_item.sku_id;
            product_name := v_item.snapshot_product_name;
            sku_name := v_item.snapshot_sku_name;
            quantity := v_item.quantity;
            content := v_inv.content;
            RETURN NEXT;
        END LOOP;
        UPDATE public.guest_shop_checkout_batches
           SET fulfillment_status = 'delivered',
               fulfilled_at = COALESCE(fulfilled_at, clock_timestamp()),
               last_error_code = NULL,
               last_error_message = NULL,
               updated_at = clock_timestamp()
         WHERE id = p_batch_id
           AND fulfillment_status <> 'delivered';
        RETURN;
    END IF;

    IF v_consumed > 0 THEN
        RAISE EXCEPTION 'guest_inventory_not_reservable';
    END IF;
    SELECT COUNT(*) INTO v_invalid
      FROM public.guest_shop_checkout_reservations r
      LEFT JOIN public.shop_inventory i ON i.id = r.inventory_id
     WHERE r.batch_id = p_batch_id
       AND (i.id IS NULL OR i.status <> 'reserve' OR COALESCE(i.is_shared, false));
    IF v_invalid > 0 THEN
        UPDATE public.guest_shop_checkout_items
           SET fulfillment_status = 'paid_unfulfillable',
               last_error_code = 'guest_inventory_not_reservable',
               last_error_message = '支付成功后库存状态异常',
               updated_at = clock_timestamp()
         WHERE batch_id = p_batch_id AND fulfillment_status <> 'delivered';
        UPDATE public.guest_shop_checkout_batches
           SET fulfillment_status = 'paid_unfulfillable',
               refund_status = CASE WHEN refund_status = 'succeeded' THEN refund_status ELSE 'pending' END,
               last_error_code = 'guest_inventory_not_reservable',
               last_error_message = '支付成功后库存状态异常',
               updated_at = clock_timestamp()
         WHERE id = p_batch_id;
        RETURN;
    END IF;

    FOR v_item IN
        SELECT i.*
          FROM public.guest_shop_checkout_items i
         WHERE i.batch_id = p_batch_id
         ORDER BY i.item_index
    LOOP
        FOR v_res IN
            SELECT r.*
              FROM public.guest_shop_checkout_reservations r
             WHERE r.item_id = v_item.id
             ORDER BY r.created_at, r.id
        LOOP
            SELECT * INTO v_inv
              FROM public.shop_inventory
             WHERE id = v_res.inventory_id
             FOR UPDATE;
            UPDATE public.shop_inventory
               SET status = 'sold',
                   sold_at = COALESCE(sold_at, clock_timestamp())
             WHERE id = v_res.inventory_id AND status = 'reserve';
            IF NOT FOUND THEN
                RAISE EXCEPTION 'guest_inventory_not_reservable';
            END IF;
            UPDATE public.guest_shop_checkout_reservations
               SET status = 'consumed',
                   consumed_at = clock_timestamp(),
                   updated_at = clock_timestamp()
             WHERE id = v_res.id AND status = 'held';
            item_id := v_item.id;
            item_index := v_item.item_index;
            product_id := v_item.product_id;
            sku_id := v_item.sku_id;
            product_name := v_item.snapshot_product_name;
            sku_name := v_item.snapshot_sku_name;
            quantity := v_item.quantity;
            content := v_inv.content;
            RETURN NEXT;
        END LOOP;
        UPDATE public.guest_shop_checkout_items
           SET fulfillment_status = 'delivered',
               delivered_at = COALESCE(delivered_at, clock_timestamp()),
               updated_at = clock_timestamp()
         WHERE id = v_item.id;
    END LOOP;
    UPDATE public.guest_shop_checkout_batches
       SET fulfillment_status = 'delivered',
           fulfilled_at = COALESCE(fulfilled_at, clock_timestamp()),
           last_error_code = NULL,
           last_error_message = NULL,
           updated_at = clock_timestamp()
     WHERE id = p_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_guest_shop_claim_checkout_batch(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_claim_checkout_batch(UUID) FROM PUBLIC, anon, authenticated;
