-- ============================================
-- 双站点 - 更新 RPC 函数
-- 所有涉及交易的函数增加 p_site 参数
-- ============================================

-- ============================================
-- 1. fn_purchase_shop_item - 商城购买（核心）
-- 增加 p_site 参数，按站点选择价格和扣积分
-- ============================================

CREATE OR REPLACE FUNCTION fn_purchase_shop_item(
    p_product_id UUID, 
    p_user_id UUID,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_product_price INT;
    v_user_balance INT;
    v_inventory_id UUID;
    v_content TEXT;
    v_product_name VARCHAR;
    v_order_id UUID;
BEGIN
    -- A. 检查商品是否存在，根据站点选择价格
    IF p_site = 'intl' THEN
        SELECT price_points_intl, name INTO v_product_price, v_product_name
        FROM shop_products
        WHERE id = p_product_id AND is_active = true;
    ELSE
        SELECT price_points, name INTO v_product_price, v_product_name
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
    WHERE user_id = p_user_id AND site = p_site
    FOR UPDATE; -- 锁定余额行

    IF v_user_balance IS NULL OR v_user_balance < v_product_price THEN
        RETURN jsonb_build_object('success', false, 'message', '积分余额不足');
    END IF;

    -- 扣除积分（优先扣 bonus，其次扣 paid）
    DECLARE
        v_current_bonus INT;
        v_current_paid INT;
        v_deduct_bonus INT := 0;
        v_deduct_paid INT := 0;
        v_remaining_cost INT := v_product_price;
    BEGIN
        SELECT bonus_balance, paid_balance INTO v_current_bonus, v_current_paid
        FROM points_balance WHERE user_id = p_user_id AND site = p_site;
        
        -- 扣 Bonus
        IF v_current_bonus >= v_remaining_cost THEN
            v_deduct_bonus := v_remaining_cost;
            v_remaining_cost := 0;
        ELSE
            v_deduct_bonus := v_current_bonus;
            v_remaining_cost := v_remaining_cost - v_current_bonus;
        END IF;
        
        -- 扣 Paid
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
        WHERE user_id = p_user_id AND site = p_site;
    END;

    -- 记账 (Ledger) - 带 site 字段
    INSERT INTO points_ledger (user_id, amount, reason, reference_id, site)
    VALUES (
        p_user_id, 
        -v_product_price, 
        'shop_purchase: ' || v_product_name,
        p_product_id::TEXT,
        p_site
    );

    -- D. 更新库存状态
    UPDATE shop_inventory
    SET status = 'sold',
        buyer_id = p_user_id,
        sold_at = NOW()
    WHERE id = v_inventory_id;

    -- E. 创建订单 - 带 site 字段
    INSERT INTO shop_orders (user_id, product_id, inventory_id, price_paid, snapshot_product_name, site)
    VALUES (p_user_id, p_product_id, v_inventory_id, v_product_price, v_product_name, p_site)
    RETURNING id INTO v_order_id;
    
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
            'remaining_points', (v_user_balance - v_product_price)
        )
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '交易失败: ' || SQLERRM);
END;
$$;

-- ============================================
-- 2. fn_get_user_balance - 获取对应站点余额
-- ============================================

CREATE OR REPLACE FUNCTION fn_get_user_balance(
    p_user_id UUID DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result RECORD;
    v_uid UUID;
BEGIN
    -- Use p_user_id if provided (server-side), else auth.uid() (client-side)
    v_uid := COALESCE(p_user_id, auth.uid());
    
    SELECT paid_balance, bonus_balance, total_balance
    INTO v_result
    FROM points_balance
    WHERE user_id = v_uid AND site = p_site;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'paid_balance', 0,
            'bonus_balance', 0,
            'total_balance', 0,
            'site', p_site
        );
    END IF;
    
    RETURN jsonb_build_object(
        'paid_balance', v_result.paid_balance,
        'bonus_balance', v_result.bonus_balance,
        'total_balance', v_result.total_balance,
        'site', p_site
    );
END;
$$;

-- Drop old signature to avoid conflicts
DROP FUNCTION IF EXISTS fn_get_user_balance(UUID);
DROP FUNCTION IF EXISTS fn_get_user_balance(VARCHAR);
GRANT EXECUTE ON FUNCTION fn_get_user_balance(UUID, VARCHAR) TO anon, authenticated;

-- ============================================
-- 3. unlock_prompt - Prompt 解锁（带 site）
-- ============================================

CREATE OR REPLACE FUNCTION public.unlock_prompt(
    p_prompt_id BIGINT, 
    p_cost INTEGER,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID;
    v_balance INTEGER;
BEGIN
    v_user_id := auth.uid();
    
    -- 检查对应站点的余额
    SELECT total_balance INTO v_balance 
    FROM points_balance 
    WHERE user_id = v_user_id AND site = p_site;
    
    IF v_balance IS NULL OR v_balance < p_cost THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient points');
    END IF;
    
    -- 检查是否已在该站解锁
    IF EXISTS (
        SELECT 1 FROM public.prompt_unlocks 
        WHERE user_id = v_user_id AND prompt_id = p_prompt_id AND site = p_site
    ) THEN
        RETURN jsonb_build_object('success', true, 'message', 'Already unlocked');
    END IF;

    -- 扣除积分（简化：直接扣 bonus 优先）
    DECLARE
        v_current_bonus INT;
        v_current_paid INT;
        v_deduct_bonus INT := 0;
        v_deduct_paid INT := 0;
        v_remaining INT := p_cost;
    BEGIN
        SELECT bonus_balance, paid_balance INTO v_current_bonus, v_current_paid
        FROM points_balance WHERE user_id = v_user_id AND site = p_site FOR UPDATE;
        
        IF v_current_bonus >= v_remaining THEN
            v_deduct_bonus := v_remaining;
        ELSE
            v_deduct_bonus := v_current_bonus;
            v_deduct_paid := v_remaining - v_current_bonus;
        END IF;
        
        UPDATE points_balance
        SET bonus_balance = bonus_balance - v_deduct_bonus,
            paid_balance = paid_balance - v_deduct_paid,
            updated_at = NOW()
        WHERE user_id = v_user_id AND site = p_site;
    END;
    
    -- 记账
    INSERT INTO points_ledger (user_id, event_type, amount, balance_snapshot, description, metadata, site)
    VALUES (
        v_user_id,
        'unlock_prompt',
        -p_cost,
        v_balance - p_cost,
        'Unlock prompt #' || p_prompt_id,
        jsonb_build_object('prompt_id', p_prompt_id),
        p_site
    );
    
    -- 记录解锁
    INSERT INTO public.prompt_unlocks (user_id, prompt_id, cost, site)
    VALUES (v_user_id, p_prompt_id, p_cost, p_site);
    
    RETURN jsonb_build_object('success', true, 'new_balance', v_balance - p_cost);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. track_event - 埋点（带 site）
-- ============================================

CREATE OR REPLACE FUNCTION track_event(
    p_event_type TEXT,
    p_event_name TEXT,
    p_event_data JSONB DEFAULT '{}',
    p_page_url TEXT DEFAULT NULL,
    p_session_id TEXT DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS UUID AS $$
DECLARE
    v_event_id UUID;
BEGIN
    INSERT INTO public.user_events (
        user_id, session_id, event_type, event_name, 
        event_data, page_url, site, created_at
    ) VALUES (
        auth.uid(), p_session_id, p_event_type, p_event_name,
        p_event_data, p_page_url, p_site, NOW()
    )
    RETURNING id INTO v_event_id;
    
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5. unlock_prompt_v2 - V2 Prompt 解锁（带 site + ban 检查）
-- 前端实际调用的是这个版本
-- ============================================

DROP FUNCTION IF EXISTS public.unlock_prompt_v2(text, integer);
DROP FUNCTION IF EXISTS public.unlock_prompt_v2(text, bigint);
DROP FUNCTION IF EXISTS public.unlock_prompt_v2(text, integer, varchar);

CREATE OR REPLACE FUNCTION public.unlock_prompt_v2(
    p_prompt_id TEXT, 
    p_cost INTEGER,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_total_balance INTEGER;
  v_paid_balance INTEGER;
  v_bonus_balance INTEGER;
  v_prompt_id_bigint BIGINT;
  v_is_banned BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  
  IF p_prompt_id IS NULL OR p_prompt_id = '' THEN
      RETURN jsonb_build_object('success', false, 'error', '无效的 Prompt ID');
  END IF;

  v_prompt_id_bigint := p_prompt_id::BIGINT;
  
  -- 1. BAN CHECK
  SELECT EXISTS (
      SELECT 1 FROM public.blocked_users 
      WHERE user_id = v_user_id 
      AND (scope = 'points_usage' OR scope = 'all')
      AND (expires_at IS NULL OR expires_at > NOW())
  ) INTO v_is_banned;

  IF v_is_banned THEN
      RETURN jsonb_build_object('success', false, 'error', '您的积分消费功能已被暂时冻结');
  END IF;
  
  -- 2. Balance Check (site-specific)
  SELECT paid_balance, bonus_balance 
  INTO v_paid_balance, v_bonus_balance
  FROM public.points_balance 
  WHERE user_id = v_user_id AND site = p_site;

  v_paid_balance := COALESCE(v_paid_balance, 0);
  v_bonus_balance := COALESCE(v_bonus_balance, 0);
  v_total_balance := v_paid_balance + v_bonus_balance;
  
  IF v_total_balance < p_cost THEN
    RETURN jsonb_build_object('success', false, 'error', '积分不足，无法解锁');
  END IF;
  
  -- 3. Check if already unlocked (site-specific)
  IF EXISTS (
      SELECT 1 FROM public.prompt_unlocks 
      WHERE user_id = v_user_id AND prompt_id = v_prompt_id_bigint AND site = p_site
  ) THEN
    RETURN jsonb_build_object('success', true, 'message', '该内容已解锁', 'already_unlocked', true);
  END IF;

  -- 4. Deduct Points (bonus first)
  DECLARE
    v_cost_remaining INTEGER := p_cost;
    v_new_bonus INTEGER := v_bonus_balance;
    v_new_paid INTEGER := v_paid_balance;
  BEGIN
      IF v_new_bonus >= v_cost_remaining THEN
          v_new_bonus := v_new_bonus - v_cost_remaining;
          v_cost_remaining := 0;
      ELSE
          v_cost_remaining := v_cost_remaining - v_new_bonus;
          v_new_bonus := 0;
      END IF;
      
      IF v_cost_remaining > 0 THEN
          IF v_new_paid >= v_cost_remaining THEN
              v_new_paid := v_new_paid - v_cost_remaining;
              v_cost_remaining := 0;
          ELSE
              RETURN jsonb_build_object('success', false, 'error', '计算错误：积分扣除异常');
          END IF;
      END IF;
      
      UPDATE public.points_balance
      SET paid_balance = v_new_paid, bonus_balance = v_new_bonus, updated_at = NOW()
      WHERE user_id = v_user_id AND site = p_site;
  END;

  -- 5. Ledger entry (with site)
  INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
  VALUES (v_user_id, -p_cost, 'unlock_prompt', p_prompt_id, p_site);
  
  -- 6. Record unlock (with site)
  INSERT INTO public.prompt_unlocks (user_id, prompt_id, cost, site)
  VALUES (v_user_id, v_prompt_id_bigint, p_cost, p_site);
  
  RETURN jsonb_build_object('success', true, 'new_balance', v_paid_balance + v_bonus_balance - p_cost);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 6. fn_recharge_points - 充值积分（带 site）
-- PK 为 (user_id, site)，ON CONFLICT 需匹配
-- ============================================

CREATE OR REPLACE FUNCTION fn_recharge_points(
    target_user_id UUID,
    p_paid INTEGER,
    p_bonus INTEGER,
    p_reason TEXT,
    p_reference_id TEXT,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS JSONB AS $$
DECLARE
    v_new_balance RECORD;
BEGIN
    -- 1. Insert into Ledger (with site)
    INSERT INTO points_ledger (user_id, amount, reason, reference_id, site)
    VALUES (target_user_id, p_paid + p_bonus, p_reason, p_reference_id, p_site);

    -- 2. Update Balance Table (Upsert with composite PK)
    INSERT INTO points_balance (user_id, site, paid_balance, bonus_balance)
    VALUES (target_user_id, p_site, p_paid, p_bonus)
    ON CONFLICT (user_id, site)
    DO UPDATE SET
        paid_balance = points_balance.paid_balance + EXCLUDED.paid_balance,
        bonus_balance = points_balance.bonus_balance + EXCLUDED.bonus_balance,
        updated_at = NOW()
    RETURNING paid_balance, bonus_balance, total_balance INTO v_new_balance;
        
    RETURN jsonb_build_object(
        'success', true,
        'paid', v_new_balance.paid_balance,
        'bonus', v_new_balance.bonus_balance,
        'total', v_new_balance.total_balance
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 7. fn_add_points - 加积分（带 site）
-- ============================================

CREATE OR REPLACE FUNCTION fn_add_points(
    target_user_id UUID,
    p_amount INT,
    p_reason TEXT DEFAULT 'System Add',
    p_reference_id TEXT DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    new_paid INT;
    new_bonus INT;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Amount must be positive';
    END IF;

    INSERT INTO points_balance (user_id, site, paid_balance, bonus_balance)
    VALUES (target_user_id, p_site, p_amount, 0)
    ON CONFLICT (user_id, site) DO UPDATE SET
        paid_balance = points_balance.paid_balance + p_amount,
        updated_at = NOW(),
        version = points_balance.version + 1
    RETURNING paid_balance, bonus_balance INTO new_paid, new_bonus;

    INSERT INTO points_ledger (user_id, amount, reason, reference_id, site)
    VALUES (target_user_id, p_amount, p_reason, p_reference_id, p_site);

    RETURN jsonb_build_object(
        'success', true,
        'new_total', new_paid + new_bonus,
        'added', p_amount
    );
END;
$$;

-- ============================================
-- 8. fn_deduct_points - 扣积分（带 site）
-- ============================================

CREATE OR REPLACE FUNCTION fn_deduct_points(
    p_amount INT,
    p_reason TEXT DEFAULT 'Consumption',
    p_reference_id TEXT DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    target_user_id UUID := auth.uid();
    current_bonus INT;
    current_paid INT;
    deduct_from_bonus INT := 0;
    deduct_from_paid INT := 0;
BEGIN
    SELECT bonus_balance, paid_balance INTO current_bonus, current_paid
    FROM points_balance
    WHERE user_id = target_user_id AND site = p_site
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User balance account not found';
    END IF;

    IF (current_bonus + current_paid) < p_amount THEN
        RAISE EXCEPTION 'Insufficient balance';
    END IF;

    IF current_bonus >= p_amount THEN
        deduct_from_bonus := p_amount;
    ELSE
        deduct_from_bonus := current_bonus;
        deduct_from_paid := p_amount - current_bonus;
    END IF;

    UPDATE points_balance
    SET bonus_balance = bonus_balance - deduct_from_bonus,
        paid_balance = paid_balance - deduct_from_paid,
        updated_at = NOW(),
        version = version + 1
    WHERE user_id = target_user_id AND site = p_site;

    INSERT INTO points_ledger (user_id, amount, reason, reference_id, site)
    VALUES (target_user_id, -p_amount, p_reason, p_reference_id, p_site);

    RETURN jsonb_build_object(
        'success', true,
        'deducted', p_amount,
        'new_total', (current_bonus + current_paid - p_amount)
    );
END;
$$;

-- ============================================
-- 9. fn_redeem_code - 兑换码（带 site）
-- 通过 fn_add_points 间接支持 site
-- ============================================

CREATE OR REPLACE FUNCTION fn_redeem_code(
    p_code VARCHAR,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS JSON AS $$
DECLARE
    v_code_record RECORD;
    v_batch_record RECORD;
    v_package RECORD;
    v_points_amount INT;
    v_effective_expires_at TIMESTAMPTZ;
BEGIN
    p_code := UPPER(TRIM(p_code));

    SELECT * INTO v_code_record
    FROM redemption_codes
    WHERE code = p_code
    FOR UPDATE;

    IF v_code_record IS NULL THEN
        RETURN json_build_object('success', false, 'message', '无效的兑换码');
    END IF;

    IF v_code_record.status = 'used' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被使用');
    ELSIF v_code_record.status = 'revoked' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被撤销');
    ELSIF v_code_record.status = 'locked' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被锁定');
    ELSIF v_code_record.status = 'disabled' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被禁用');
    END IF;

    SELECT expires_at INTO v_batch_record FROM redemption_batches WHERE id = v_code_record.batch_id;
    v_effective_expires_at := COALESCE(v_code_record.expires_at, v_batch_record.expires_at);
    
    IF v_effective_expires_at IS NOT NULL AND v_effective_expires_at < NOW() THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已过期');
    END IF;

    SELECT * INTO v_package FROM points_packages WHERE id = v_code_record.package_id;
    IF v_package IS NULL THEN
        RETURN json_build_object('success', false, 'message', '关联的套餐不存在');
    END IF;

    v_points_amount := v_package.points_amount + COALESCE(v_package.bonus_points, 0);

    -- 调用带 site 的 fn_add_points
    PERFORM fn_add_points(
        auth.uid(),
        v_points_amount,
        '兑换码充值: ' || v_package.name,
        'redeem_' || p_code,
        p_site
    );

    UPDATE redemption_codes
    SET status = 'used',
        used_by = auth.uid(),
        used_at = NOW(),
        points_granted = v_points_amount
    WHERE id = v_code_record.id;

    RETURN json_build_object(
        'success', true,
        'message', '兑换成功！',
        'points', v_points_amount,
        'package_name', v_package.name
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 完成！所有 RPC 函数已更新为双站点感知
-- ============================================
