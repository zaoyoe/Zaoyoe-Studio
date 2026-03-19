-- 1. 添加阶梯定价规则字段
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS quantity_rules JSONB DEFAULT '[]'::JSONB;

-- 2. 升级 shop_orders 表以支持多物品
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS total_price INT;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS item_count INT DEFAULT 1;

-- 如果之前是 price_paid 代表总价，把现有数据迁移到 total_price
UPDATE shop_orders SET total_price = price_paid WHERE total_price IS NULL;

-- 3. 创建 shop_order_items 表 (配合 WalletModal 的高级展示)
CREATE TABLE IF NOT EXISTS shop_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES shop_orders(id) ON DELETE CASCADE,
    inventory_id UUID REFERENCES shop_inventory(id),
    snapshot_product_name VARCHAR(100),
    price_paid INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS for shop_order_items
ALTER TABLE shop_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own order items" ON shop_order_items;
CREATE POLICY "Users view own order items" ON shop_order_items FOR SELECT USING (
    order_id IN (SELECT id FROM shop_orders WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "Admins view all order items" ON shop_order_items;
CREATE POLICY "Admins view all order items" ON shop_order_items FOR SELECT USING (
    public.is_admin()
);

-- 4. 升级 fn_purchase_shop_item 支持批量购买和阶梯定价
CREATE OR REPLACE FUNCTION fn_purchase_shop_item(
    p_product_id UUID, 
    p_user_id UUID, 
    p_site VARCHAR DEFAULT 'cn',
    p_quantity INT DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_product RECORD;
    v_unit_price INT;
    v_total_price INT;
    v_user_balance NUMERIC(12,1);
    
    v_inventory_ids UUID[];
    v_contents TEXT[];
    
    v_order_id UUID;
    v_rule JSONB;
    v_rule_qty INT;
    v_rule_price INT;
BEGIN
    IF p_quantity < 1 THEN
        RETURN jsonb_build_object('success', false, 'message', '购买数量必须大于0');
    END IF;

    -- A. Check Product and Pricing
    SELECT id, price_points, name, quantity_rules INTO v_product
    FROM shop_products
    WHERE id = p_product_id AND is_active = true;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '商品不存在或已下架');
    END IF;

    -- Calculate Unit Price based on quantity_rules
    v_unit_price := v_product.price_points;
    
    IF v_product.quantity_rules IS NOT NULL AND jsonb_array_length(v_product.quantity_rules) > 0 THEN
        FOR v_rule IN SELECT * FROM jsonb_array_elements(v_product.quantity_rules)
        LOOP
            v_rule_qty := (v_rule->>'qty')::INT;
            v_rule_price := (v_rule->>'price')::INT;
            
            IF p_quantity >= v_rule_qty AND v_rule_price < v_unit_price THEN
                v_unit_price := v_rule_price;
            END IF;
        END LOOP;
    END IF;

    v_total_price := v_unit_price * p_quantity;

    -- B. Lock Inventory (Bulk Extraction)
    SELECT array_agg(id), array_agg(content) INTO v_inventory_ids, v_contents
    FROM (
        SELECT id, content FROM shop_inventory
        WHERE product_id = p_product_id AND status = 'available'
        LIMIT p_quantity
        FOR UPDATE SKIP LOCKED
    ) t;
    
    IF v_inventory_ids IS NULL OR array_length(v_inventory_ids, 1) < p_quantity THEN
        RETURN jsonb_build_object('success', false, 'message', '商品库存不足，无法满足当前数量');
    END IF;

    -- C. Check Balance
    SELECT total_balance INTO v_user_balance
    FROM points_balance
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF v_user_balance IS NULL OR v_user_balance < v_total_price THEN
        RETURN jsonb_build_object('success', false, 'message', '积分余额不足');
    END IF;

    -- 1. Deduct Points
    DECLARE
        v_current_bonus NUMERIC(12,1);
        v_current_paid NUMERIC(12,1);
        v_deduct_bonus NUMERIC(12,1) := 0;
        v_deduct_paid NUMERIC(12,1) := 0;
        v_remaining_cost NUMERIC(12,1) := v_total_price;
    BEGIN
        SELECT bonus_balance, paid_balance INTO v_current_bonus, v_current_paid
        FROM points_balance WHERE user_id = p_user_id;
        
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
        WHERE user_id = p_user_id;
    END;

    -- D. Update Inventory Status
    UPDATE shop_inventory
    SET status = 'sold',
        buyer_id = p_user_id,
        sold_at = NOW()
    WHERE id = ANY(v_inventory_ids);

    -- E. Create Master Order
    INSERT INTO shop_orders (user_id, product_id, price_paid, total_price, item_count, snapshot_product_name)
    VALUES (p_user_id, p_product_id, v_total_price, v_total_price, p_quantity, v_product.name)
    RETURNING id INTO v_order_id;
    
    -- Insert sub-items for WalletModal history
    INSERT INTO shop_order_items (order_id, inventory_id, snapshot_product_name, price_paid)
    SELECT v_order_id, unnest(v_inventory_ids), v_product.name, v_unit_price;

    -- 2. Ledger
    INSERT INTO points_ledger (user_id, amount, reason, reference_id)
    VALUES (
        p_user_id, 
        -v_total_price, 
        '商城购买: ' || v_product.name || ' x' || p_quantity,
        'SHOP_ORDER_' || v_order_id
    );

    -- F. (Trigger tr_low_stock_alert handles stock_count usually, but if relying on the decrement script, we do it here) 
    -- 依赖前端触发器更新，这里不减库存 (根据之前的架构保留原状)

    RETURN jsonb_build_object(
        'success', true, 
        'message', '购买成功',
        'data', jsonb_build_object(
            'content', array_to_string(v_contents, E'\n----\n'),
            'order_id', v_order_id,
            'product_name', v_product.name,
            'remaining_points', (v_user_balance - v_total_price)
        )
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '交易失败: ' || SQLERRM);
END;
$$;
