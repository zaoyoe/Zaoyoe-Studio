-- 1. 添加 delivery_type 和 webhook_target 字段
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS delivery_type VARCHAR(20) DEFAULT 'KEY'; -- 'KEY' 或者是 'API'
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS webhook_target TEXT;

-- 2. 创建 Webhook 任务队列队列表
CREATE TABLE IF NOT EXISTS shop_webhook_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES shop_orders(id) ON DELETE CASCADE,
    target_url TEXT NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    executed_at TIMESTAMPTZ
);

ALTER TABLE shop_webhook_tasks ENABLE ROW LEVEL SECURITY;

-- 3. 重写 fn_purchase_shop_item 支持外部接口履约
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
    
    v_user_balance INT;
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

    -- A. Check Product
    SELECT id, price_points, name, quantity_rules, flash_sale_end, flash_sale_price, delivery_type, webhook_target 
    INTO v_product
    FROM shop_products
    WHERE id = p_product_id AND is_active = true;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '商品不存在或已下架');
    END IF;

    -- B. Verify Pricing Logic
    IF v_product.flash_sale_end IS NOT NULL AND v_product.flash_sale_end > NOW() AND v_product.flash_sale_price IS NOT NULL THEN
        v_unit_price := v_product.flash_sale_price;
    ELSE
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
    END IF;

    v_total_price := v_unit_price * p_quantity;

    -- C. Apply Discount Code
    IF p_discount_code IS NOT NULL AND TRIM(p_discount_code) <> '' THEN
        p_discount_code := UPPER(TRIM(p_discount_code));
        
        SELECT * INTO v_discount_record FROM discount_codes WHERE code = p_discount_code FOR UPDATE;
        
        IF NOT FOUND OR v_discount_record.is_active = false THEN
            RETURN jsonb_build_object('success', false, 'message', '无效的优惠码');
        END IF;
        
        IF v_discount_record.expires_at IS NOT NULL AND v_discount_record.expires_at < NOW() THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码已过期');
        END IF;
        
        IF v_discount_record.max_uses > 0 AND v_discount_record.used_count >= v_discount_record.max_uses THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码的使用次数已达上限');
        END IF;
        
        IF v_discount_record.discount_type = 'percent' THEN
            v_discount_amount := v_total_price - (v_total_price * v_discount_record.discount_value / 100);
        ELSIF v_discount_record.discount_type = 'fixed' THEN
            v_discount_amount := LEAST(v_total_price, v_discount_record.discount_value);
        END IF;
        
        v_total_price := GREATEST(0, v_total_price - v_discount_amount);
    END IF;

    -- D. Inventory vs API Check
    IF v_product.delivery_type = 'KEY' OR v_product.delivery_type IS NULL THEN
        -- Standard Flow: lock cart keys
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
    ELSIF v_product.delivery_type = 'API' THEN
        -- API Flow: Skip key extraction, generate pseudo contents
        v_contents := ARRAY['您的订单信息已通过 API Webhook 推送至第三方商户，请留意履约通知。'];
    ELSE
        RETURN jsonb_build_object('success', false, 'message', '未知的发货模式: ' || v_product.delivery_type);
    END IF;

    -- E. Check Balance Before Deduction
    SELECT total_balance INTO v_user_balance FROM points_balance WHERE user_id = p_user_id FOR UPDATE;

    IF v_user_balance IS NULL OR v_user_balance < v_total_price THEN
        RETURN jsonb_build_object('success', false, 'message', '积分余额不足');
    END IF;

    -- 1. Deduct Points
    IF v_total_price > 0 THEN
        DECLARE
            v_current_bonus INT;
            v_current_paid INT;
            v_deduct_bonus INT := 0;
            v_deduct_paid INT := 0;
            v_remaining_cost INT := v_total_price;
        BEGIN
            SELECT bonus_balance, paid_balance INTO v_current_bonus, v_current_paid
            FROM points_balance WHERE user_id = p_user_id;
            
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
                    RETURN jsonb_build_object('success', false, 'message', '余额扣款异常');
                END IF;
            END IF;

            UPDATE points_balance
            SET bonus_balance = bonus_balance - v_deduct_bonus,
                paid_balance = paid_balance - v_deduct_paid,
                updated_at = NOW()
            WHERE user_id = p_user_id;
        END;
    END IF;

    -- Update Discount Count
    IF v_discount_amount > 0 AND p_discount_code IS NOT NULL THEN
        UPDATE discount_codes SET used_count = used_count + 1 WHERE code = p_discount_code;
    END IF;

    -- F. Master Order
    INSERT INTO shop_orders (user_id, product_id, price_paid, total_price, item_count, snapshot_product_name, discount_code, discount_amount)
    VALUES (p_user_id, p_product_id, v_total_price, v_total_price + v_discount_amount, p_quantity, v_product.name, p_discount_code, v_discount_amount)
    RETURNING id INTO v_order_id;
    
    -- G. Inventory / Webhook Write
    IF v_product.delivery_type = 'KEY' OR v_product.delivery_type IS NULL THEN
        UPDATE shop_inventory
        SET status = 'sold', buyer_id = p_user_id, sold_at = NOW()
        WHERE id = ANY(v_inventory_ids);

        INSERT INTO shop_order_items (order_id, inventory_id, snapshot_product_name, price_paid)
        SELECT v_order_id, unnest(v_inventory_ids), v_product.name, v_unit_price;
    ELSIF v_product.delivery_type = 'API' THEN
        -- Write webhook task
        INSERT INTO shop_webhook_tasks (order_id, target_url, payload)
        VALUES (
            v_order_id, 
            v_product.webhook_target, 
            jsonb_build_object('user_id', p_user_id, 'order_id', v_order_id, 'product_id', p_product_id, 'quantity', p_quantity)
        );
        -- Pseudo sub-item for display
        INSERT INTO shop_order_items (order_id, inventory_id, snapshot_product_name, price_paid)
        VALUES (v_order_id, NULL, v_product.name || ' [API]', v_total_price);
    END IF;

    -- 2. Ledger
    IF v_total_price > 0 THEN
        INSERT INTO points_ledger (user_id, amount, reason, reference_id)
        VALUES (p_user_id, -v_total_price, '商城购买: ' || v_product.name, 'SHOP_ORDER_' || v_order_id);
    END IF;

    -- H. Affiliate Commission (推广返佣 10%)
    DECLARE
        v_inviter_id UUID;
        v_commission INT;
        v_commission_rate FLOAT := 0.10;
    BEGIN
        SELECT invited_by INTO v_inviter_id FROM profiles WHERE id = p_user_id;
        IF v_inviter_id IS NOT NULL AND v_total_price > 0 THEN
            v_commission := FLOOR(v_total_price * v_commission_rate);
            IF v_commission > 0 THEN
                UPDATE points_balance SET bonus_balance = bonus_balance + v_commission, updated_at = NOW() WHERE user_id = v_inviter_id;
                INSERT INTO points_ledger (user_id, amount, reason, reference_id) VALUES (v_inviter_id, v_commission, '推广返佣', 'AFFILIATE_REWARD_' || v_order_id);
            END IF;
        END IF;
    END;

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
