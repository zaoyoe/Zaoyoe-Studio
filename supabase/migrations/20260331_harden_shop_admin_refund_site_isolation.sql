-- Harden admin shop refund RPC for dual-site accounting and service-only access.
-- Note: shop_orders still does not persist paid/bonus spend breakdowns, so refunds
-- currently restore the order amount back into paid balance for the matching site.

DROP FUNCTION IF EXISTS public.fn_admin_refund_order(UUID, UUID);
DROP FUNCTION IF EXISTS public.fn_admin_refund_order(UUID, UUID, VARCHAR);
DROP FUNCTION IF EXISTS public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT);

CREATE OR REPLACE FUNCTION public.fn_admin_refund_order(
    p_order_id UUID,
    p_admin_id UUID,
    p_target_status VARCHAR DEFAULT 'frozen',
    p_remark TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order RECORD;
    v_status_map JSONB := '{"available":"在售","frozen":"冻结","fault":"故障","reserve":"保留"}'::JSONB;
    v_site VARCHAR(10);
    v_refund_reference TEXT;
    v_refund_reason TEXT;
    v_refund_amount NUMERIC(12,1);
    v_recharge_result JSONB := '{}'::JSONB;
    v_inventory_ids UUID[];
    v_stock_count INT := 0;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'p_order_id is required';
    END IF;

    IF p_admin_id IS NULL THEN
        RAISE EXCEPTION 'p_admin_id is required';
    END IF;

    IF NOT (v_status_map ? COALESCE(p_target_status, '')) THEN
        RETURN jsonb_build_object('success', false, 'message', '无效的目标状态');
    END IF;

    SELECT
        o.id,
        o.user_id,
        o.product_id,
        o.inventory_id,
        o.price_paid,
        o.total_price,
        o.snapshot_product_name,
        o.refund_status,
        o.delivery_status,
        o.delivery_completed_at,
        o.site
    INTO v_order
    FROM public.shop_orders o
    WHERE o.id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '订单不存在');
    END IF;

    v_site := COALESCE(NULLIF(BTRIM(v_order.site), ''), 'cn');
    v_refund_reference := 'REFUND_' || p_order_id::TEXT;
    v_refund_amount := GREATEST(COALESCE(v_order.price_paid, 0), 0);

    IF COALESCE(v_order.refund_status, 'none') IN ('refunded', 'full_refund') THEN
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'site', v_site,
            'message', '该订单已退款'
        );
    END IF;

    IF v_refund_amount > 0 THEN
        v_refund_reason := '订单退款: ' || COALESCE(NULLIF(BTRIM(v_order.snapshot_product_name), ''), '未知商品');

        SELECT public.fn_recharge_points(
            v_order.user_id,
            v_refund_amount,
            0,
            v_refund_reason,
            v_refund_reference,
            v_site
        )
        INTO v_recharge_result;

        IF COALESCE((v_recharge_result ->> 'success')::BOOLEAN, false) IS NOT TRUE THEN
            RETURN jsonb_build_object(
                'success', false,
                'message', COALESCE(v_recharge_result ->> 'message', '退款积分返还失败'),
                'site', v_site
            );
        END IF;
    END IF;

    SELECT ARRAY(
        SELECT DISTINCT inventory_id
        FROM (
            SELECT v_order.inventory_id AS inventory_id
            UNION ALL
            SELECT soi.inventory_id
            FROM public.shop_order_items soi
            WHERE soi.order_id = p_order_id
        ) inventory_rows
        WHERE inventory_id IS NOT NULL
    )
    INTO v_inventory_ids;

    IF COALESCE(array_length(v_inventory_ids, 1), 0) > 0 THEN
        UPDATE public.shop_inventory
        SET status = p_target_status,
            remark = COALESCE(NULLIF(BTRIM(p_remark), ''), remark),
            buyer_id = NULL,
            sold_at = NULL
        WHERE id = ANY(v_inventory_ids);
    END IF;

    UPDATE public.shop_orders
    SET refund_status = 'refunded',
        delivery_status = 'refunded',
        delivery_completed_at = COALESCE(delivery_completed_at, NOW()),
        delivery_updated_at = NOW()
    WHERE id = p_order_id;

    SELECT COUNT(*)
    INTO v_stock_count
    FROM public.shop_inventory
    WHERE product_id = v_order.product_id
      AND status = 'available';

    UPDATE public.shop_products
    SET stock_count = v_stock_count
    WHERE id = v_order.product_id;

    RETURN jsonb_build_object(
        'success', true,
        'site', v_site,
        'duplicate', false,
        'message', '退款成功，库存已标记为: ' || (v_status_map ->> p_target_status)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) TO service_role;
