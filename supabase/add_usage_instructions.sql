-- ============================================
-- 商品"使用说明"功能 - 数据库变更
-- ============================================

-- 1. 新增字段
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS show_usage_instructions BOOLEAN DEFAULT false;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS usage_instructions TEXT;

-- 2. 更新 fn_purchase_shop_item 函数
--    返回值增加 usage_instructions 和 show_usage_instructions
CREATE OR REPLACE FUNCTION fn_purchase_shop_item(
    p_product_id UUID, 
    p_user_id UUID,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
    v_usage_instructions TEXT;
    v_show_usage_instructions BOOLEAN;
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

    -- A. 检查商品是否存在，根据站点选择价格
    IF p_site = 'intl' THEN
        SELECT price_points_intl, name, usage_instructions, show_usage_instructions
        INTO v_product_price, v_product_name, v_usage_instructions, v_show_usage_instructions
        FROM shop_products
        WHERE id = p_product_id AND is_active = true;
    ELSE
        SELECT price_points, name, usage_instructions, show_usage_instructions
        INTO v_product_price, v_product_name, v_usage_instructions, v_show_usage_instructions
        FROM shop_products
        WHERE id = p_product_id AND is_active = true;
    END IF;
    
    IF NOT FOUND OR v_product_price IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '商品不存在、已下架或未在该站点定价');
    END IF;

    -- B. 锁定库存 (SKIP LOCKED防止并发冲突)
    SELECT id, content INTO v_inventory_id, v_content
    FROM shop_inventory
    WHERE product_id = p_product_id AND status = 'available'
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
    
    IF v_inventory_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '商品库存不足');
    END IF;

    -- C. 检查对应站点的余额 & 扣费
    SELECT total_balance INTO v_user_balance
    FROM points_balance
    WHERE user_id = v_effective_user_id AND site = p_site
    FOR UPDATE;

    IF v_user_balance IS NULL OR v_user_balance < v_product_price THEN
        RETURN jsonb_build_object('success', false, 'message', '积分余额不足');
    END IF;

    -- 扣除积分（优先扣 bonus，其次扣 paid）
    DECLARE
        v_current_bonus NUMERIC(12,1);
        v_current_paid NUMERIC(12,1);
        v_deduct_bonus NUMERIC(12,1) := 0;
        v_deduct_paid NUMERIC(12,1) := 0;
        v_remaining_cost NUMERIC(12,1) := v_product_price;
    BEGIN
        SELECT bonus_balance, paid_balance INTO v_current_bonus, v_current_paid
        FROM points_balance WHERE user_id = v_effective_user_id AND site = p_site;
        
        IF v_current_bonus >= v_remaining_cost THEN
            v_deduct_bonus := v_remaining_cost;
            v_remaining_cost := 0;
        ELSE
            v_deduct_bonus := v_current_bonus;
            v_remaining_cost := v_remaining_cost - v_current_bonus;
        END IF;
        
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
        WHERE user_id = v_effective_user_id AND site = p_site;
    END;

    -- D. 更新库存状态
    UPDATE shop_inventory
    SET status = 'sold',
        buyer_id = v_effective_user_id,
        sold_at = NOW()
    WHERE id = v_inventory_id;

    -- E. 创建订单 - 带 site 字段
    INSERT INTO shop_orders (user_id, product_id, inventory_id, price_paid, snapshot_product_name, site)
    VALUES (v_effective_user_id, p_product_id, v_inventory_id, v_product_price, v_product_name, p_site)
    RETURNING id INTO v_order_id;

    -- 记账 (Ledger) - 带 site 字段和订单级引用
    INSERT INTO points_ledger (user_id, amount, reason, reference_id, site)
    VALUES (
        v_effective_user_id,
        -v_product_price,
        '商城购买: ' || v_product_name,
        'SHOP_ORDER_' || v_order_id,
        p_site
    );
    
    -- F. 更新商品库存计数缓存
    UPDATE shop_products 
    SET stock_count = stock_count - 1 
    WHERE id = p_product_id;

    RETURN jsonb_build_object(
        'success', true, 
        'message', '购买成功',
        'data', jsonb_build_object(
            'content', v_content,
            'order_id', v_order_id,
            'product_name', v_product_name,
            'remaining_points', (v_user_balance - v_product_price),
            'usage_instructions', CASE WHEN v_show_usage_instructions THEN v_usage_instructions ELSE NULL END,
            'show_usage_instructions', COALESCE(v_show_usage_instructions, false)
        )
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '交易失败: ' || SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION fn_purchase_shop_item(UUID, UUID, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_purchase_shop_item(UUID, UUID, VARCHAR) TO authenticated, service_role;
