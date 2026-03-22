-- ============================================
-- Phase 3: 商城与自动发货系统 - 数据库架构
-- ============================================

-- 1. 商品表 (Products)
CREATE TABLE IF NOT EXISTS shop_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    icon_url VARCHAR(255),                  -- 商品图标 (FontAwesome类名 或 URL)
    price_points INT NOT NULL CHECK (price_points >= 0),
    category VARCHAR(50) DEFAULT 'account', -- account, api_key, resource
    tags JSONB DEFAULT '[]'::JSONB,         -- ["hot", "new"]
    display_order INT DEFAULT 0,            -- 排序权重
    is_active BOOLEAN DEFAULT true,         -- 上架状态
    
    -- 库存统计 (通过触发器自动更新，为了查询性能)
    stock_count INT DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 库存表 (Inventory)
CREATE TABLE IF NOT EXISTS shop_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES shop_products(id) ON DELETE CASCADE,
    
    -- 核心内容 (发货前对普通用户不可见)
    content TEXT NOT NULL,                  -- 卡密/账号密码 (格式: 账号----密码 或 JSON)
    
    status VARCHAR(20) DEFAULT 'available', -- available, sold, frozen (有问题)
    batch_id VARCHAR(50),                   -- 导入批次号
    
    -- 售出信息
    buyer_id UUID REFERENCES auth.users(id),
    sold_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 订单表 (Orders)
CREATE TABLE IF NOT EXISTS shop_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    product_id UUID REFERENCES shop_products(id),
    inventory_id UUID REFERENCES shop_inventory(id),
    
    price_paid INT NOT NULL,                -- 实际支付积分
    snapshot_product_name VARCHAR(100),     -- 购买时的商品名快照
    
    email_sent BOOLEAN DEFAULT false,       -- 邮件是否已发送
    refund_status VARCHAR(20) DEFAULT 'none', -- none, refunded
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 索引
CREATE INDEX IF NOT EXISTS idx_shop_inventory_status ON shop_inventory(product_id, status);
CREATE INDEX IF NOT EXISTS idx_shop_orders_user ON shop_orders(user_id);

-- 5. RLS 策略
ALTER TABLE shop_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_orders ENABLE ROW LEVEL SECURITY;

-- Products: 所有人可读，管理员可写
CREATE POLICY "Public read products" ON shop_products FOR SELECT USING (true);
CREATE POLICY "Admins manage products" ON shop_products FOR ALL USING (public.is_admin());

-- Inventory: 管理员全权，用户只能看自己买到的
CREATE POLICY "Admins manage inventory" ON shop_inventory FOR ALL USING (
    public.is_admin()
);
CREATE POLICY "Users view purchased inventory" ON shop_inventory 
    FOR SELECT USING (buyer_id = auth.uid());

-- Orders: 用户看自己的，管理员看所有
CREATE POLICY "Users view own orders" ON shop_orders FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Admins view all orders" ON shop_orders FOR SELECT USING (
    public.is_admin()
);

-- Admin RPC to lookup order with content (bypasses RLS)
DROP FUNCTION IF EXISTS fn_admin_lookup_order(UUID);

CREATE OR REPLACE FUNCTION fn_admin_lookup_order(p_order_id UUID DEFAULT NULL)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    product_id UUID,
    inventory_id UUID,
    price_paid INT,
    snapshot_product_name VARCHAR,
    refund_status VARCHAR,
    created_at TIMESTAMPTZ,
    inventory_content TEXT,
    inventory_status VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied: Admin only';
    END IF;

    RETURN QUERY
    SELECT 
        o.id,
        o.user_id,
        o.product_id,
        o.inventory_id,
        o.price_paid,
        o.snapshot_product_name,
        o.refund_status,
        o.created_at,
        i.content AS inventory_content,
        i.status AS inventory_status
    FROM shop_orders o
    LEFT JOIN shop_inventory i ON o.inventory_id = i.id
    WHERE (p_order_id IS NULL OR o.id = p_order_id)
    ORDER BY o.created_at DESC
    LIMIT 50;
END;
$$;


-- 6. 核心交易函数 (Atomic Purchase)
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

    -- A. 检查商品是否存在及价格
    SELECT price_points, name INTO v_product_price, v_product_name
    FROM shop_products
    WHERE id = p_product_id AND is_active = true;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '商品不存在或已下架');
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

    -- C. 检查余额 & 扣费
    SELECT total_balance INTO v_user_balance
    FROM points_balance
    WHERE user_id = v_effective_user_id
    FOR UPDATE; -- 锁定余额行

    IF v_user_balance IS NULL OR v_user_balance < v_product_price THEN
        RETURN jsonb_build_object('success', false, 'message', '积分余额不足');
    END IF;

    -- 1. 扣除积分 (优先扣 paid, 其次 bonus - 这里简化为直接扣余额，具体逻辑看 balance 表定义)
    -- 假设 points_balance 有 trigger 处理 paid/bonus 分配，或者我们简单 update total?
    -- 由于 total 是 generated，我们需要 update paid_balance 和 bonus_balance.
    -- 简单起见，这里假设 update paid_balance (如果不够扣 bonus? 需要复杂逻辑).
    -- 为了简化，我们可以复用 points_ledger 触发器? 或者手动计算.
    -- 这里采用简单策略：优先扣 bonus (赠送的)，不够扣 paid.
    
    DECLARE
        v_current_bonus NUMERIC(12,1);
        v_current_paid NUMERIC(12,1);
        v_deduct_bonus NUMERIC(12,1) := 0;
        v_deduct_paid NUMERIC(12,1) := 0;
        v_remaining_cost NUMERIC(12,1) := v_product_price;
    BEGIN
        SELECT bonus_balance, paid_balance INTO v_current_bonus, v_current_paid
        FROM points_balance WHERE user_id = v_effective_user_id;
        
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
        WHERE user_id = v_effective_user_id;
    END;

    -- D. 更新库存状态
    UPDATE shop_inventory
    SET status = 'sold',
        buyer_id = v_effective_user_id,
        sold_at = NOW()
    WHERE id = v_inventory_id;

    -- E. 创建订单
    INSERT INTO shop_orders (user_id, product_id, inventory_id, price_paid, snapshot_product_name)
    VALUES (v_effective_user_id, p_product_id, v_inventory_id, v_product_price, v_product_name)
    RETURNING id INTO v_order_id;

    -- 2. 也是最重要的：记账 (Ledger)
    INSERT INTO points_ledger (user_id, event_type, amount, balance_snapshot, description, metadata)
    VALUES (
        v_effective_user_id,
        'shop_purchase',
        -v_product_price,
        (v_user_balance - v_product_price),
        '购买商品: ' || v_product_name,
        jsonb_build_object(
            'product_id', p_product_id,
            'order_id', v_order_id,
            'inventory_id', v_inventory_id
        )
    );
    
    -- F. 更新商品库存计数缓存 (非事务关键，但方便显示)
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

-- 7. 管理员退款函数 (Admin Refund)
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

    -- 1. 返还积分 (全部返还到 bonus_balance 简单处理，或者 paid_balance? 假设返还到 paid 更良心)
    UPDATE points_balance
    SET paid_balance = paid_balance + v_order.price_paid,
        updated_at = NOW()
    WHERE user_id = v_order.user_id
    RETURNING total_balance INTO v_current_balance;

    -- 2. 记账
    INSERT INTO points_ledger (user_id, event_type, amount, balance_snapshot, description, metadata)
    VALUES (
        v_order.user_id, 
        'shop_refund', 
        v_order.price_paid, 
        v_current_balance, 
        '订单退款: ' || v_order.snapshot_product_name,
        jsonb_build_object('order_id', p_order_id, 'admin_id', p_admin_id)
    );

    -- 3. 标记库存为 'frozen' (问题卡密)
    UPDATE shop_inventory
    SET status = 'frozen',
        buyer_id = NULL -- 解除绑定? 或者保留绑定但标记 frozen? 解除绑定防止用户继续看
    WHERE id = v_order.inventory_id;

    -- 4. 标记订单
    UPDATE shop_orders
    SET refund_status = 'refunded'
    WHERE id = p_order_id;

    RETURN jsonb_build_object('success', true, 'message', '退款成功，积分已返还，卡密已冻结');
END;
$$;

-- Initial Seed (Example Product)
-- INSERT INTO shop_products (name, description, price_points, icon_url) 
-- VALUES ('Gemini Pro 独享号', '官方正版，稳定独享，带API Key', 50, 'fa-gem');
