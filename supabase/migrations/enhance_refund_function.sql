-- 增强版管理员退款函数 (V4)
-- 支持自定义退款后的库存状态 (Available, Frozen, Fault, Reserve) 和备注

DROP FUNCTION IF EXISTS fn_admin_refund_order(UUID, UUID);

CREATE OR REPLACE FUNCTION fn_admin_refund_order(
    p_order_id UUID, 
    p_admin_id UUID,
    p_target_status VARCHAR DEFAULT 'frozen', -- 新增: 目标状态 (available, frozen, fault, reserve)
    p_remark TEXT DEFAULT NULL                -- 新增: 备注原因
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order RECORD;
    v_current_balance INT;
    v_status_map JSONB := '{"available": "在售", "frozen": "冻结", "fault": "故障", "reserve": "保留"}';
BEGIN
    -- 权限检查
    IF NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '无权操作');
    END IF;

    -- 验证目标状态是否合法
    IF NOT (v_status_map ? p_target_status) THEN
         RETURN jsonb_build_object('success', false, 'message', '无效的目标状态');
    END IF;

    SELECT * INTO v_order FROM shop_orders WHERE id = p_order_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '订单不存在');
    END IF;
    
    IF v_order.refund_status = 'refunded' THEN
        RETURN jsonb_build_object('success', false, 'message', '该订单已退款');
    END IF;

    -- 1. 返还积分
    UPDATE points_balance
    SET paid_balance = paid_balance + v_order.price_paid,
        updated_at = NOW()
    WHERE user_id = v_order.user_id
    RETURNING total_balance INTO v_current_balance;

    -- 2. 记账
    INSERT INTO points_ledger (user_id, amount, reason, reference_id)
    VALUES (
        v_order.user_id, 
        v_order.price_paid, 
        '订单退款: ' || COALESCE(v_order.snapshot_product_name, '未知商品'),
        'REFUND_' || p_order_id
    );

    -- 3. 更新库存状态 (支持单品和多品)
    -- 注意: 只有当目标状态为 'available' 时，我们才保留 buyer_id 为 NULL (即彻底释放)
    -- 如果是 frozen/fault/reserve，通常也应清空 buyer_id，因为已经退款了。
    -- 所以这里统一清空 buyer_id。
    
    -- 3.1 主表
    IF v_order.inventory_id IS NOT NULL THEN
        UPDATE shop_inventory
        SET status = p_target_status,
            remark = COALESCE(p_remark, remark), -- 如果有新备注则更新，否则保持原样(或覆盖? 假设覆盖)
            buyer_id = NULL,
            sold_at = NULL -- 如果重新上架，售出时间也应清空? 是的。
        WHERE id = v_order.inventory_id;
    END IF;

    -- 3.2 子表 (多品订单)
    BEGIN
        UPDATE shop_inventory
        SET status = p_target_status,
            remark = COALESCE(p_remark, remark),
            buyer_id = NULL,
            sold_at = NULL
        WHERE id IN (
            SELECT inventory_id FROM shop_order_items WHERE order_id = p_order_id
        );
    EXCEPTION WHEN undefined_table THEN
        NULL;
    END;
    
    -- 4. 标记订单
    UPDATE shop_orders
    SET refund_status = 'refunded'
    WHERE id = p_order_id;

    RETURN jsonb_build_object('success', true, 'message', '退款成功，库存已标记为: ' || (v_status_map ->> p_target_status));
END;
$$;
GRANT EXECUTE ON FUNCTION fn_admin_refund_order TO authenticated;
