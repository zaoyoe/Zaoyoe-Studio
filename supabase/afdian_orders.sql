-- Afdian Orders Table
-- Stores orders from 爱发电 and generated redemption codes

CREATE TABLE IF NOT EXISTS afdian_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    out_trade_no TEXT UNIQUE NOT NULL,      -- 爱发电订单号
    afdian_user_id TEXT,                     -- 爱发电用户ID
    plan_id TEXT,                            -- 发电方案ID
    total_amount DECIMAL(10,2) NOT NULL,     -- 支付金额
    points INTEGER NOT NULL,                 -- 对应积分
    redeem_code TEXT,                        -- 生成的兑换码
    is_redeemed BOOLEAN DEFAULT false,       -- 兑换码是否已使用
    remark TEXT,                             -- 用户留言
    raw_payload JSONB,                       -- 原始webhook数据
    created_at TIMESTAMPTZ DEFAULT now(),
    redeemed_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_afdian_orders_trade_no ON afdian_orders(out_trade_no);
CREATE INDEX IF NOT EXISTS idx_afdian_orders_code ON afdian_orders(redeem_code);

-- RLS Policies (admin only for direct access, public for code query)
ALTER TABLE afdian_orders ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists, then create
DROP POLICY IF EXISTS "Anyone can query code by order number" ON afdian_orders;

-- Allow anyone to query by order number (read-only, specific columns)
CREATE POLICY "Anyone can query code by order number" ON afdian_orders
    FOR SELECT USING (true);

-- Function to query redemption code by order number
CREATE OR REPLACE FUNCTION fn_query_afdian_code(p_order_no TEXT)
RETURNS TABLE(
    code TEXT,
    points INTEGER,
    is_redeemed BOOLEAN,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ao.redeem_code,
        ao.points,
        ao.is_redeemed,
        ao.created_at
    FROM afdian_orders ao
    WHERE ao.out_trade_no = p_order_no;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_query_afdian_code TO anon, authenticated;

-- Function to generate code for Afdian order (called by webhook server)
CREATE OR REPLACE FUNCTION fn_create_afdian_order(
    p_order_no TEXT,
    p_afdian_user_id TEXT,
    p_plan_id TEXT,
    p_amount DECIMAL,
    p_points INTEGER,
    p_remark TEXT,
    p_payload JSONB
)
RETURNS TEXT  -- Returns generated code
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_code TEXT;
    v_existing_code TEXT;
BEGIN
    -- Check if order already exists (idempotency)
    SELECT redeem_code INTO v_existing_code
    FROM afdian_orders
    WHERE out_trade_no = p_order_no;
    
    IF v_existing_code IS NOT NULL THEN
        RETURN v_existing_code;  -- Return existing code
    END IF;
    
    -- Generate unique code: ZY-XXXX-XXXX-XXXX
    v_code := 'ZY-' || 
              upper(substring(md5(random()::text) from 1 for 4)) || '-' ||
              upper(substring(md5(random()::text) from 1 for 4)) || '-' ||
              upper(substring(md5(random()::text) from 1 for 4));
    
    -- Insert order with code
    INSERT INTO afdian_orders (
        out_trade_no,
        afdian_user_id,
        plan_id,
        total_amount,
        points,
        redeem_code,
        remark,
        raw_payload
    ) VALUES (
        p_order_no,
        p_afdian_user_id,
        p_plan_id,
        p_amount,
        p_points,
        v_code,
        p_remark,
        p_payload
    );
    
    -- Also create the redemption code in redemption_codes table
    INSERT INTO redemption_codes (
        code,
        points_amount,
        is_used,
        batch_id
    ) VALUES (
        v_code,
        p_points,
        false,
        NULL  -- No batch for Afdian codes
    ) ON CONFLICT (code) DO NOTHING;
    
    RETURN v_code;
END;
$$;

-- Grant to service role only (server-side use)
REVOKE ALL ON FUNCTION fn_create_afdian_order FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_create_afdian_order TO service_role;
