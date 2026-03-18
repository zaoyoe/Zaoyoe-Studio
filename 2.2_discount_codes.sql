-- 1. 创建优惠券表
CREATE TABLE IF NOT EXISTS discount_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,      -- 例: WINTER20, VIP50
    discount_type VARCHAR(20) NOT NULL,    -- 'percent' (百分比), 'fixed' (定额抵扣)
    discount_value INT NOT NULL,           -- 打折比例 (0-100) 或抵扣积分
    max_uses INT DEFAULT 0,                -- 最大使用次数 (0 = 无限)
    used_count INT DEFAULT 0,              -- 已使用次数
    expires_at TIMESTAMPTZ,                -- 过期时间
    is_active BOOLEAN DEFAULT true,        -- 是否启用
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT chk_discount_type CHECK (discount_type IN ('percent', 'fixed')),
    CONSTRAINT chk_discount_value_percent CHECK (
        (discount_type = 'percent' AND discount_value > 0 AND discount_value <= 100) OR
        (discount_type = 'fixed' AND discount_value > 0)
    )
);

-- 优惠券 RLS
ALTER TABLE discount_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage discount codes" ON discount_codes FOR ALL USING (public.is_admin());
CREATE POLICY "Public read active discount codes" ON discount_codes FOR SELECT USING (is_active = true);


-- 2. 在订单表中增加优惠券记录
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS discount_code VARCHAR(50);
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS discount_amount INT DEFAULT 0;


-- 3. 具有折扣码验证逻辑的购买扩展
CREATE OR REPLACE FUNCTION fn_purchase_shop_item(
    p_product_id UUID, 
    p_user_id UUID, 
    p_site VARCHAR DEFAULT 'cn',
    p_quantity INT DEFAULT 1,
    p_discount_code VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_product RECORD;
    v_unit_price INT;
    v_total_price INT;
    v_discount_record RECORD;
    v_discount_amount INT := 0;
    
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

    -- B. Verify and Apply Discount Code
    IF p_discount_code IS NOT NULL AND TRIM(p_discount_code) <> '' THEN
        p_discount_code := UPPER(TRIM(p_discount_code));
        
        -- Use FOR UPDATE to prevent race conditions on usage count
        SELECT * INTO v_discount_record
        FROM discount_codes
        WHERE code = p_discount_code 
        FOR UPDATE;
        
        IF NOT FOUND OR v_discount_record.is_active = false THEN
            RETURN jsonb_build_object('success', false, 'message', '无效的优惠码');
        END IF;
        
        IF v_discount_record.expires_at IS NOT NULL AND v_discount_record.expires_at < NOW() THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码已过期');
        END IF;
        
        IF v_discount_record.max_uses > 0 AND v_discount_record.used_count >= v_discount_record.max_uses THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码的使用次数已达上限');
        END IF;
        
        -- Calculate Discount
        IF v_discount_record.discount_type = 'percent' THEN
            -- Calculate discount amount (round down)
            v_discount_amount := v_total_price - (v_total_price * v_discount_record.discount_value / 100);
        ELSIF v_discount_record.discount_type = 'fixed' THEN
            v_discount_amount := LEAST(v_total_price, v_discount_record.discount_value);
        END IF;
        
        -- Apply discount to total price
        v_total_price := GREATEST(0, v_total_price - v_discount_amount);
    END IF;

    -- C. Lock Inventory (Bulk Extraction)
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

    -- D. Check Balance
    SELECT total_balance INTO v_user_balance
    FROM points_balance
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF v_user_balance IS NULL OR v_user_balance < v_total_price THEN
        RETURN jsonb_build_object('success', false, 'message', '积分余额不足');
    END IF;

    -- 1. Deduct Points (If total_price > 0)
    IF v_total_price > 0 THEN
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
    END IF;

    -- Update Discount Code usage count if applicable
    IF v_discount_amount > 0 AND p_discount_code IS NOT NULL THEN
        UPDATE discount_codes
        SET used_count = used_count + 1
        WHERE code = p_discount_code;
    END IF;

    -- E. Update Inventory Status
    UPDATE shop_inventory
    SET status = 'sold',
        buyer_id = p_user_id,
        sold_at = NOW()
    WHERE id = ANY(v_inventory_ids);

    -- F. Create Master Order
    INSERT INTO shop_orders (user_id, product_id, price_paid, total_price, item_count, snapshot_product_name, discount_code, discount_amount)
    VALUES (p_user_id, p_product_id, v_total_price, v_total_price + v_discount_amount, p_quantity, v_product.name, p_discount_code, v_discount_amount)
    RETURNING id INTO v_order_id;
    
    -- Insert sub-items for WalletModal history
    INSERT INTO shop_order_items (order_id, inventory_id, snapshot_product_name, price_paid)
    SELECT v_order_id, unnest(v_inventory_ids), v_product.name, v_unit_price;

    -- 2. Ledger
    IF v_total_price > 0 THEN
        INSERT INTO points_ledger (user_id, amount, reason, reference_id)
        VALUES (
            p_user_id, 
            -v_total_price, 
            '商城购买: ' || v_product.name || ' x' || p_quantity || CASE WHEN v_discount_amount > 0 THEN ' (使用优惠码)' ELSE '' END,
            'SHOP_ORDER_' || v_order_id
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true, 
        'message', '购买成功',
        'data', jsonb_build_object(
            'content', array_to_string(v_contents, E'\n----\n'),
            'order_id', v_order_id,
            'product_name', v_product.name,
            'remaining_points', GREATEST(0, v_user_balance - v_total_price)
        )
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '交易失败: ' || SQLERRM);
END;
$$;
