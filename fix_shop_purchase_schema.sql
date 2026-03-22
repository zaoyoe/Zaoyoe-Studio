-- Fix Purchase and Refund Functions to match points_ledger schema
-- Schema uses: user_id, amount, reason, reference_id

-- 1. Fix Purchase Function
CREATE OR REPLACE FUNCTION fn_purchase_shop_item(p_product_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_effective_user_id UUID;
    v_product_price INT;
    v_user_balance NUMERIC(12,1);
    v_inventory_id UUID;
    v_content TEXT;
    v_product_name VARCHAR;
    v_order_id UUID;
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'message', '请先登录');
        END IF;

        IF p_user_id IS NOT NULL AND p_user_id <> v_request_user_id THEN
            RETURN jsonb_build_object('success', false, 'message', '非法的用户上下文');
        END IF;

        v_effective_user_id := v_request_user_id;
    END IF;

    IF v_effective_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '缺少有效的用户身份');
    END IF;

    -- A. Check Product
    SELECT price_points, name INTO v_product_price, v_product_name
    FROM shop_products
    WHERE id = p_product_id AND is_active = true;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '商品不存在或已下架');
    END IF;

    -- B. Lock Inventory
    SELECT id, content INTO v_inventory_id, v_content
    FROM shop_inventory
    WHERE product_id = p_product_id AND status = 'available'
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
    
    IF v_inventory_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '商品库存不足');
    END IF;

    -- C. Check Balance
    SELECT total_balance INTO v_user_balance
    FROM points_balance
    WHERE user_id = v_effective_user_id
    FOR UPDATE;

    IF v_user_balance IS NULL OR v_user_balance < v_product_price THEN
        RETURN jsonb_build_object('success', false, 'message', '积分余额不足');
    END IF;

    -- 1. Deduct Points
    DECLARE
        v_current_bonus NUMERIC(12,1);
        v_current_paid NUMERIC(12,1);
        v_deduct_bonus NUMERIC(12,1) := 0;
        v_deduct_paid NUMERIC(12,1) := 0;
        v_remaining_cost NUMERIC(12,1) := v_product_price;
    BEGIN
        SELECT bonus_balance, paid_balance INTO v_current_bonus, v_current_paid
        FROM points_balance WHERE user_id = v_effective_user_id;
        
        -- Deduct Bonus First
        IF v_current_bonus >= v_remaining_cost THEN
            v_deduct_bonus := v_remaining_cost;
            v_remaining_cost := 0;
        ELSE
            v_deduct_bonus := v_current_bonus;
            v_remaining_cost := v_remaining_cost - v_current_bonus;
        END IF;
        
        -- Deduct Paid
        IF v_remaining_cost > 0 THEN
            IF v_current_paid >= v_remaining_cost THEN
                v_deduct_paid := v_remaining_cost;
            ELSE
                RETURN jsonb_build_object('success', false, 'message', '系统错误：余额计算异常');
            END IF;
        END IF;

        UPDATE points_balance
        SET bonus_balance = bonus_balance - v_deduct_bonus,
            paid_balance = paid_balance - v_deduct_paid,
            updated_at = NOW()
        WHERE user_id = v_effective_user_id;
    END;

    -- D. Update Inventory Status
    UPDATE shop_inventory
    SET status = 'sold',
        buyer_id = v_effective_user_id,
        sold_at = NOW()
    WHERE id = v_inventory_id;

    -- E. Create Order (Get Order ID for Reference)
    INSERT INTO shop_orders (user_id, product_id, inventory_id, price_paid, snapshot_product_name)
    VALUES (v_effective_user_id, p_product_id, v_inventory_id, v_product_price, v_product_name)
    RETURNING id INTO v_order_id;

    -- 2. Ledger (Using Order ID as Reference)
    -- Fixed: Uses correct columns (amount, reason, reference_id)
    INSERT INTO points_ledger (user_id, amount, reason, reference_id)
    VALUES (
        v_effective_user_id,
        -v_product_price, 
        '商城购买: ' || v_product_name,
        'SHOP_ORDER_' || v_order_id
    );

    -- F. Update Product Stock Count
    -- REMOVED: Managed by trigger 'tr_shop_inventory_stock' to avoid double counting
    -- UPDATE shop_products 
    -- SET stock_count = stock_count - 1 
    -- WHERE id = p_product_id;

    RETURN jsonb_build_object(
        'success', true, 
        'message', '购买成功',
        'data', jsonb_build_object(
            'content', v_content,
            'order_id', v_order_id,
            'product_name', v_product_name,
            'remaining_points', (v_user_balance - v_product_price)
        )
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '交易失败: ' || SQLERRM);
END;
$$;


-- 2. Fix Refund Function
CREATE OR REPLACE FUNCTION fn_admin_refund_order(p_order_id UUID, p_admin_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order RECORD;
    v_current_balance NUMERIC(12,1);
BEGIN
    -- Check Admin
    IF NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', '无权操作');
    END IF;

    SELECT * INTO v_order FROM shop_orders WHERE id = p_order_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '订单不存在');
    END IF;
    
    IF v_order.refund_status = 'refunded' THEN
        RETURN jsonb_build_object('success', false, 'message', '该订单已退款');
    END IF;

    -- 1. Refund Points (to paid_balance)
    UPDATE points_balance
    SET paid_balance = paid_balance + v_order.price_paid,
        updated_at = NOW()
    WHERE user_id = v_order.user_id
    RETURNING total_balance INTO v_current_balance;

    -- 2. Ledger
    -- Fixed: Uses correct columns (amount, reason, reference_id)
    INSERT INTO points_ledger (user_id, amount, reason, reference_id)
    VALUES (
        v_order.user_id, 
        v_order.price_paid, 
        '订单退款: ' || v_order.snapshot_product_name,
        'REFUND_' || p_order_id
    );

    -- 3. Freeze Inventory
    UPDATE shop_inventory
    SET status = 'frozen',
        buyer_id = NULL
    WHERE id = v_order.inventory_id;

    -- 4. Mark Order
    UPDATE shop_orders
    SET refund_status = 'refunded'
    WHERE id = p_order_id;

    RETURN jsonb_build_object('success', true, 'message', '退款成功，积分已返还，卡密已冻结');
END;
$$;
