-- 1. 为 profiles 表增加邀请码和上线字段
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS invite_code VARCHAR(20) UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES profiles(id);

-- 填充现有用户的邀请码 (取 UUID 的前 8 位大写)
UPDATE profiles SET invite_code = UPPER(SUBSTRING(id::text, 1, 8)) WHERE invite_code IS NULL;

-- 2. 创建触发器：新用户注册时自动生成专属邀请码
CREATE OR REPLACE FUNCTION fn_generate_invite_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.invite_code IS NULL THEN
        NEW.invite_code := UPPER(SUBSTRING(NEW.id::text, 1, 8));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_generate_invite_code ON profiles;
CREATE TRIGGER tr_generate_invite_code
    BEFORE INSERT ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION fn_generate_invite_code();

-- 3. 修改购买函数以支持层级分销返佣 (10% 返佣比例)
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
    SELECT id, price_points, name, quantity_rules, flash_sale_end, flash_sale_price INTO v_product
    FROM shop_products
    WHERE id = p_product_id AND is_active = true;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '商品不存在或已下架');
    END IF;

    -- B. Verify Pricing Logic
    -- Priority 1: Flash Sale (if active) overrides everything
    IF v_product.flash_sale_end IS NOT NULL AND v_product.flash_sale_end > NOW() AND v_product.flash_sale_price IS NOT NULL THEN
        v_unit_price := v_product.flash_sale_price;
    ELSE
        -- Priority 2: Quantity Rules (Tiered Pricing) and Base Price
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

    -- C. Verify and Apply Discount Code
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
            v_discount_amount := v_total_price - (v_total_price * v_discount_record.discount_value / 100);
        ELSIF v_discount_record.discount_type = 'fixed' THEN
            v_discount_amount := LEAST(v_total_price, v_discount_record.discount_value);
        END IF;
        
        -- Apply discount to total price
        v_total_price := GREATEST(0, v_total_price - v_discount_amount);
    END IF;

    -- D. Lock Inventory (Bulk Extraction)
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

    -- E. Check Balance
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

    -- F. Update Inventory Status
    UPDATE shop_inventory
    SET status = 'sold',
        buyer_id = p_user_id,
        sold_at = NOW()
    WHERE id = ANY(v_inventory_ids);

    -- G. Create Master Order
    INSERT INTO shop_orders (user_id, product_id, price_paid, total_price, item_count, snapshot_product_name, discount_code, discount_amount)
    VALUES (p_user_id, p_product_id, v_total_price, v_total_price + v_discount_amount, p_quantity, v_product.name, p_discount_code, v_discount_amount)
    RETURNING id INTO v_order_id;
    
    -- Insert sub-items for WalletModal history
    INSERT INTO shop_order_items (order_id, inventory_id, snapshot_product_name, price_paid)
    SELECT v_order_id, unnest(v_inventory_ids), v_product.name, v_unit_price;

    -- 2. Ledger for Buyer
    IF v_total_price > 0 THEN
        INSERT INTO points_ledger (user_id, amount, reason, reference_id)
        VALUES (
            p_user_id, 
            -v_total_price, 
            '商城购买: ' || v_product.name || ' x' || p_quantity || CASE WHEN v_discount_amount > 0 THEN ' (使用优惠码)' ELSE '' END,
            'SHOP_ORDER_' || v_order_id
        );
    END IF;

    -- H. Affiliate Commission (推广返佣)
    DECLARE
        v_inviter_id UUID;
        v_commission NUMERIC(12,1);
        v_commission_rate FLOAT;
        v_affiliate_config JSONB;
    BEGIN
        SELECT config_value INTO v_affiliate_config
        FROM system_config
        WHERE config_key = 'affiliate_program';

        v_commission_rate := COALESCE(
            (v_affiliate_config->>'commission_rate_shop')::FLOAT,
            (SELECT value::FLOAT FROM system_settings WHERE key = 'commission_rate_shop'),
            0.10
        );
        
        SELECT invited_by INTO v_inviter_id FROM profiles WHERE id = p_user_id;
        
        IF v_inviter_id IS NOT NULL AND v_total_price > 0 THEN
            v_commission := ROUND((v_total_price * v_commission_rate)::NUMERIC, 1);
            
            IF v_commission > 0 THEN
                -- 给上线增加 bonus 积分
                UPDATE points_balance 
                SET bonus_balance = bonus_balance + v_commission,
                    updated_at = NOW()
                WHERE user_id = v_inviter_id;
                
                -- 在上线的流水中记录一笔入账
                INSERT INTO points_ledger (user_id, amount, reason, reference_id)
                VALUES (
                    v_inviter_id,
                    v_commission,
                    '推广返佣 (' || (v_commission_rate * 100) || '%): 下线购买商品',
                    'AFFILIATE_REWARD_' || v_order_id
                );
            END IF;
        END IF;
    END;

    -- I. Unlock Pending Registration Rewards (防刷拉新奖励激活)
    DECLARE
        v_pending_reward RECORD;
    BEGIN
        SELECT * INTO v_pending_reward FROM pending_referral_rewards WHERE invitee_id = p_user_id;
        IF FOUND AND v_total_price > 0 THEN
            -- Grant to inviter
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
            'remaining_points', GREATEST(0, v_user_balance - v_total_price)
        )
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '交易失败: ' || SQLERRM);
END;
$$;
