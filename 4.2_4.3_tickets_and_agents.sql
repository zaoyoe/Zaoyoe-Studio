-- =========== PHASE 4.2: C2B2C 代理商分站 ===========
CREATE TABLE IF NOT EXISTS agent_prices (
    agent_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    product_id UUID REFERENCES shop_products(id) ON DELETE CASCADE,
    custom_price INT NOT NULL CHECK (custom_price > 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (agent_id, product_id)
);

ALTER TABLE agent_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view agent prices" ON agent_prices FOR SELECT USING (true);
CREATE POLICY "Agents can manage their own prices" ON agent_prices FOR ALL USING (auth.uid() = agent_id);


-- =========== PHASE 4.3: 售后工单系统 ===========
CREATE TABLE IF NOT EXISTS shop_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    order_id UUID REFERENCES shop_orders(id) ON DELETE CASCADE,
    issue_type VARCHAR(50) NOT NULL, -- e.g., 'INVALID_KEY', 'NOT_RECEIVED', 'OTHER'
    description TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'OPEN', -- 'OPEN', 'RESOLVED', 'REFUNDED', 'CLOSED'
    admin_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE shop_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tickets" ON shop_tickets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create tickets" ON shop_tickets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins have full access to tickets" ON shop_tickets FOR ALL USING (
    EXISTS (SELECT 1 FROM admin_roles ar WHERE ar.user_id = auth.uid())
);


-- 修改后的购买函数：支持动态计算代理差价
-- (注：为保证前向兼容，本函数依然保留了标准购买形态，并且可以传入 p_agent_id 用于代理商体系)
CREATE OR REPLACE FUNCTION fn_purchase_shop_item(
    p_product_id UUID, 
    p_user_id UUID, 
    p_site VARCHAR DEFAULT 'cn',
    p_quantity INT DEFAULT 1,
    p_discount_code VARCHAR DEFAULT NULL,
    p_agent_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_product RECORD;
    v_base_unit_price INT;
    v_actual_unit_price INT;
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
    
    v_agent_price INT := NULL;
    v_agent_markup INT := 0;

    v_usage_instructions TEXT;
    v_show_usage_instructions BOOLEAN;
BEGIN
    IF p_quantity < 1 THEN
        RETURN jsonb_build_object('success', false, 'message', '购买数量必须大于0');
    END IF;

    -- A. Check Product
    SELECT id, price_points, name, quantity_rules, flash_sale_end, flash_sale_price, delivery_type, webhook_target, usage_instructions, show_usage_instructions
    INTO v_product
    FROM shop_products
    WHERE id = p_product_id AND is_active = true;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '商品不存在或已下架');
    END IF;

    -- B. Calculate Base Pricing
    IF v_product.flash_sale_end IS NOT NULL AND v_product.flash_sale_end > NOW() AND v_product.flash_sale_price IS NOT NULL THEN
        v_base_unit_price := v_product.flash_sale_price;
    ELSE
        v_base_unit_price := v_product.price_points;
        IF v_product.quantity_rules IS NOT NULL AND jsonb_array_length(v_product.quantity_rules) > 0 THEN
            FOR v_rule IN SELECT * FROM jsonb_array_elements(v_product.quantity_rules)
            LOOP
                v_rule_qty := (v_rule->>'qty')::INT;
                v_rule_price := (v_rule->>'price')::INT;
                IF p_quantity >= v_rule_qty AND v_rule_price < v_base_unit_price THEN
                    v_base_unit_price := v_rule_price;
                END IF;
            END LOOP;
        END IF;
    END IF;

    v_actual_unit_price := v_base_unit_price;

    -- B2. Apply Agent Override If Any
    IF p_agent_id IS NOT NULL THEN
        SELECT custom_price INTO v_agent_price FROM agent_prices WHERE agent_id = p_agent_id AND product_id = p_product_id;
        IF v_agent_price IS NOT NULL THEN
            -- Ensure agent price is not cheaper than base price, otherwise platform loses money
            IF v_agent_price > v_base_unit_price THEN
                v_actual_unit_price := v_agent_price;
                v_agent_markup := v_agent_price - v_base_unit_price;
            END IF;
        END IF;
    END IF;

    v_total_price := v_actual_unit_price * p_quantity;

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
        
        -- Note: discount is calculated on actual total
        IF v_discount_record.discount_type = 'percent' THEN
            v_discount_amount := v_total_price - (v_total_price * v_discount_record.discount_value / 100);
        ELSIF v_discount_record.discount_type = 'fixed' THEN
            v_discount_amount := LEAST(v_total_price, v_discount_record.discount_value);
        END IF;
        
        v_total_price := GREATEST(0, v_total_price - v_discount_amount);
    END IF;

    -- D. Inventory Check
    IF v_product.delivery_type = 'KEY' OR v_product.delivery_type IS NULL THEN
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
        v_contents := ARRAY['您的订单信息已通过 API Webhook 推送至第三方商户，请留意履约通知。'];
    ELSE
        RETURN jsonb_build_object('success', false, 'message', '未知的发货模式: ' || v_product.delivery_type);
    END IF;

    -- E. Check Balance and Deduct
    SELECT total_balance INTO v_user_balance FROM points_balance WHERE user_id = p_user_id FOR UPDATE;

    IF v_user_balance IS NULL OR v_user_balance < v_total_price THEN
        RETURN jsonb_build_object('success', false, 'message', '积分余额不足');
    END IF;

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

    IF v_discount_amount > 0 AND p_discount_code IS NOT NULL THEN
        UPDATE discount_codes SET used_count = used_count + 1 WHERE code = p_discount_code;
    END IF;

    -- F. Master Order
    INSERT INTO shop_orders (user_id, product_id, price_paid, total_price, item_count, snapshot_product_name, discount_code, discount_amount)
    VALUES (p_user_id, p_product_id, v_total_price, v_total_price + v_discount_amount, p_quantity, v_product.name, p_discount_code, v_discount_amount)
    RETURNING id INTO v_order_id;
    
    -- G. Inventory Write
    IF v_product.delivery_type = 'KEY' OR v_product.delivery_type IS NULL THEN
        UPDATE shop_inventory
        SET status = 'sold', buyer_id = p_user_id, sold_at = NOW()
        WHERE id = ANY(v_inventory_ids);

        INSERT INTO shop_order_items (order_id, inventory_id, snapshot_product_name, price_paid)
        SELECT v_order_id, unnest(v_inventory_ids), v_product.name, v_actual_unit_price;
    ELSIF v_product.delivery_type = 'API' THEN
        INSERT INTO shop_webhook_tasks (order_id, target_url, payload)
        VALUES (
            v_order_id, 
            v_product.webhook_target, 
            jsonb_build_object('user_id', p_user_id, 'order_id', v_order_id, 'product_id', p_product_id, 'quantity', p_quantity)
        );
        INSERT INTO shop_order_items (order_id, inventory_id, snapshot_product_name, price_paid)
        VALUES (v_order_id, NULL, v_product.name || ' [API]', v_total_price);
    END IF;

    -- 2. Ledger - Buyer
    IF v_total_price > 0 THEN
        INSERT INTO points_ledger (user_id, amount, reason, reference_id)
        VALUES (p_user_id, -v_total_price, '商城购买: ' || v_product.name, 'SHOP_ORDER_' || v_order_id);
    END IF;

    -- 3. Leverage Affiliate Commission & Agent Markup Reward
    DECLARE
        v_inviter_id UUID;
        v_commission INT := 0;
        v_agent_profit INT := 0;
        v_commission_rate FLOAT;
        v_affiliate_config JSONB;
    BEGIN
        SELECT config_value INTO v_affiliate_config
        FROM system_config
        WHERE config_key = 'affiliate_program';

        v_commission_rate := COALESCE(
            (v_affiliate_config->>'commission_rate_agent')::FLOAT,
            (SELECT value::FLOAT FROM system_settings WHERE key = 'commission_rate_agent'),
            0.10
        );
        
        -- Handle global affiliate referral
        SELECT invited_by INTO v_inviter_id FROM profiles WHERE id = p_user_id;
        IF v_inviter_id IS NOT NULL AND v_total_price > 0 THEN
            v_commission := FLOOR(v_base_unit_price * p_quantity * v_commission_rate);
            IF v_commission > 0 THEN
                UPDATE points_balance SET bonus_balance = bonus_balance + v_commission, updated_at = NOW() WHERE user_id = v_inviter_id;
                INSERT INTO points_ledger (user_id, amount, reason, reference_id) VALUES (v_inviter_id, v_commission, '推广返佣 (' || (v_commission_rate * 100) || '%): 下线购买分销资源', 'AFF_REW_' || v_order_id);
            END IF;
        END IF;

        -- Handle Agent Direct Profit (Difference between custom price and base price)
        IF p_agent_id IS NOT NULL AND v_agent_markup > 0 AND v_total_price > 0 THEN
            -- In case discount applied, we scale agent profit based on the effective discount ratio? 
            -- Or just give them the exact markup per item
            v_agent_profit := v_agent_markup * p_quantity;
            
            IF v_agent_profit > 0 THEN
                UPDATE points_balance SET paid_balance = paid_balance + v_agent_profit, updated_at = NOW() WHERE user_id = p_agent_id;
                INSERT INTO points_ledger (user_id, amount, reason, reference_id) VALUES (p_agent_id, v_agent_profit, '代理商网店利润差额: ' || v_product.name, 'AGENT_PROF_' || v_order_id);
            END IF;
        END IF;
    END;

    -- 4. Unlock Pending Registration Rewards
    DECLARE
        v_pending_reward RECORD;
    BEGIN
        SELECT * INTO v_pending_reward FROM pending_referral_rewards WHERE invitee_id = p_user_id;
        IF FOUND AND v_total_price > 0 THEN
            UPDATE points_balance SET bonus_balance = bonus_balance + v_pending_reward.reward_points, updated_at = NOW() WHERE user_id = v_pending_reward.inviter_id;
            INSERT INTO points_ledger (user_id, amount, reason, reference_id) VALUES (v_pending_reward.inviter_id, v_pending_reward.reward_points, '拉新固定奖励 (下线首单激活)', 'REG_REWARD_UNLOCK_' || v_order_id);
            DELETE FROM pending_referral_rewards WHERE id = v_pending_reward.id;
        END IF;
    END;

    RETURN jsonb_build_object(
        'success', true, 
        'message', '购买成功',
        'data', jsonb_build_object(
            'content', array_to_string(v_contents, E'\n----\n'),
            'order_id', v_order_id,
            'product_name', v_product.name,
            'remaining_points', GREATEST(0, v_user_balance - v_total_price),
            'usage_instructions', CASE WHEN v_product.show_usage_instructions THEN v_product.usage_instructions ELSE NULL END,
            'show_usage_instructions', COALESCE(v_product.show_usage_instructions, false)
        )
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '交易失败: ' || SQLERRM);
END;
$$;
