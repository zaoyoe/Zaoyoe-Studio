-- ============================================
-- Phase 2.2: 兑换码系统 - RPC 函数
-- ============================================

-- ============================================
-- 1. 生成兑换码（管理员专用）
-- ============================================
CREATE OR REPLACE FUNCTION fn_generate_codes(
    p_batch_name VARCHAR,
    p_package_id UUID,
    p_count INT,
    p_channel VARCHAR DEFAULT 'manual',
    p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(code VARCHAR, batch_id UUID) AS $$
DECLARE
    v_batch_id UUID;
    v_code VARCHAR;
    v_chars VARCHAR := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- 去除易混淆: 0OIL1
    v_i INT;
    v_j INT;
BEGIN
    -- 检查管理员权限
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Admin only';
    END IF;

    -- 检查套餐存在
    IF NOT EXISTS (SELECT 1 FROM points_packages WHERE id = p_package_id AND is_active = true) THEN
        RAISE EXCEPTION 'Invalid package ID';
    END IF;

    -- 限制单次生成数量
    IF p_count > 1000 THEN
        RAISE EXCEPTION 'Cannot generate more than 1000 codes at once';
    END IF;

    -- 创建批次
    INSERT INTO redemption_batches (name, package_id, channel, total_count, expires_at, created_by)
    VALUES (p_batch_name, p_package_id, p_channel, p_count, p_expires_at, auth.uid())
    RETURNING id INTO v_batch_id;

    -- 生成兑换码
    FOR v_i IN 1..p_count LOOP
        -- 生成随机码: ZY-XXXX-XXXX-XXXX (12位随机 = 1.2万亿亿组合)
        v_code := 'ZY-';
        FOR v_j IN 1..4 LOOP
            v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
        END LOOP;
        v_code := v_code || '-';
        FOR v_j IN 1..4 LOOP
            v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
        END LOOP;
        v_code := v_code || '-';
        FOR v_j IN 1..4 LOOP
            v_code := v_code || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
        END LOOP;

        -- 插入兑换码（如果重复则重新生成）
        BEGIN
            INSERT INTO redemption_codes (code, batch_id, package_id)
            VALUES (v_code, v_batch_id, p_package_id);
            
            code := v_code;
            batch_id := v_batch_id;
            RETURN NEXT;
        EXCEPTION WHEN unique_violation THEN
            -- 重复则跳过，实际生成数可能少于请求数
            v_i := v_i - 1;
        END;
    END LOOP;

    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 2. 用户核销兑换码
-- ============================================
CREATE OR REPLACE FUNCTION fn_redeem_code(
    p_code VARCHAR
)
RETURNS JSON AS $$
DECLARE
    v_code_record RECORD;
    v_batch_record RECORD;
    v_package RECORD;
    v_points_amount INT;
BEGIN
    -- 标准化输入：转大写，去空格
    p_code := UPPER(TRIM(p_code));

    -- 查找兑换码（单表查询，可以使用 FOR UPDATE）
    SELECT * INTO v_code_record
    FROM redemption_codes
    WHERE code = p_code
    FOR UPDATE;

    -- 检查存在性
    IF v_code_record IS NULL THEN
        RETURN json_build_object('success', false, 'message', '无效的兑换码');
    END IF;

    -- 检查状态
    IF v_code_record.status = 'used' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被使用');
    ELSIF v_code_record.status = 'revoked' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被撤销');
    ELSIF v_code_record.status = 'locked' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被锁定');
    END IF;

    -- 单独查询批次过期时间
    SELECT expires_at INTO v_batch_record FROM redemption_batches WHERE id = v_code_record.batch_id;
    
    -- 检查过期
    IF v_batch_record.expires_at IS NOT NULL AND v_batch_record.expires_at < NOW() THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已过期');
    END IF;

    -- 获取套餐信息
    SELECT * INTO v_package FROM points_packages WHERE id = v_code_record.package_id;
    IF v_package IS NULL THEN
        RETURN json_build_object('success', false, 'message', '关联的套餐不存在');
    END IF;

    -- 计算积分
    v_points_amount := v_package.points_amount + COALESCE(v_package.bonus_points, 0);

    -- 调用积分入账函数
    PERFORM fn_add_points(
        auth.uid(),
        v_points_amount,
        '兑换码充值: ' || v_package.name,
        'redeem_' || p_code
    );

    -- 更新兑换码状态
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
-- 3. 自动发货锁定（API 专用）
-- ============================================
CREATE OR REPLACE FUNCTION fn_dispatch_code(
    p_sku_id VARCHAR,
    p_external_order_id VARCHAR
)
RETURNS JSON AS $$
DECLARE
    v_code_record RECORD;
    v_package_id UUID;
BEGIN
    -- 检查是否已发货（防重复）
    IF EXISTS (
        SELECT 1 FROM redemption_codes 
        WHERE external_order_id = p_external_order_id AND status IN ('locked', 'used')
    ) THEN
        -- 返回已发货的码
        SELECT code INTO v_code_record FROM redemption_codes 
        WHERE external_order_id = p_external_order_id LIMIT 1;
        RETURN json_build_object(
            'success', true,
            'code', v_code_record.code,
            'note', 'Already dispatched'
        );
    END IF;

    -- 根据 SKU 找到对应的套餐（需要建立 SKU 映射表，这里简化处理）
    -- TODO: 创建 sku_package_mapping 表
    -- 暂时假设 sku_id 就是 package_id
    v_package_id := p_sku_id::UUID;

    -- 获取一个可用的兑换码
    SELECT * INTO v_code_record
    FROM redemption_codes
    WHERE package_id = v_package_id
      AND status = 'pending'
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_code_record IS NULL THEN
        RETURN json_build_object('success', false, 'message', '没有可用的兑换码');
    END IF;

    -- 锁定兑换码
    UPDATE redemption_codes
    SET status = 'locked',
        locked_at = NOW(),
        external_order_id = p_external_order_id
    WHERE id = v_code_record.id;

    RETURN json_build_object(
        'success', true,
        'code', v_code_record.code,
        'expires_hint', '请在24小时内使用'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. 撤销兑换码（管理员专用）
-- ============================================
CREATE OR REPLACE FUNCTION fn_revoke_code(
    p_code VARCHAR,
    p_reason VARCHAR DEFAULT 'Admin revocation'
)
RETURNS JSON AS $$
DECLARE
    v_code_record RECORD;
    v_balance RECORD;
    v_deducted INT := 0;
BEGIN
    -- 检查管理员权限
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Admin only';
    END IF;

    -- 查找兑换码
    SELECT * INTO v_code_record
    FROM redemption_codes
    WHERE code = UPPER(TRIM(p_code))
    FOR UPDATE;

    IF v_code_record IS NULL THEN
        RETURN json_build_object('success', false, 'message', '兑换码不存在');
    END IF;

    IF v_code_record.status = 'revoked' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被撤销');
    END IF;

    -- 如果已使用，需要扣回积分
    IF v_code_record.status = 'used' AND v_code_record.used_by IS NOT NULL THEN
        -- 获取用户当前余额
        SELECT * INTO v_balance FROM points_balance WHERE user_id = v_code_record.used_by;
        
        IF v_balance IS NOT NULL THEN
            -- 计算可扣除的积分（不能扣成负数）
            v_deducted := LEAST(v_code_record.points_granted, v_balance.total_balance);
            
            IF v_deducted > 0 THEN
                -- 扣除积分
                PERFORM fn_deduct_points(
                    v_code_record.used_by,
                    v_deducted,
                    '兑换码撤销: ' || p_code,
                    'revoke_' || p_code
                );
            END IF;
        END IF;
    END IF;

    -- 更新兑换码状态
    UPDATE redemption_codes
    SET status = 'revoked',
        revoked_at = NOW(),
        revoked_by = auth.uid(),
        revoke_reason = p_reason,
        points_deducted = v_deducted
    WHERE id = v_code_record.id;

    RETURN json_build_object(
        'success', true,
        'message', '撤销成功',
        'points_deducted', v_deducted
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5. 查询兑换码状态（用户可用）
-- ============================================
CREATE OR REPLACE FUNCTION fn_check_code_status(
    p_code VARCHAR
)
RETURNS JSON AS $$
DECLARE
    v_code_record RECORD;
    v_package RECORD;
BEGIN
    -- 标准化输入
    p_code := UPPER(TRIM(p_code));

    SELECT rc.*, rb.expires_at AS batch_expires_at, rb.name AS batch_name
    INTO v_code_record
    FROM redemption_codes rc
    LEFT JOIN redemption_batches rb ON rc.batch_id = rb.id
    WHERE rc.code = p_code;

    IF v_code_record IS NULL THEN
        RETURN json_build_object('valid', false, 'message', '无效的兑换码');
    END IF;

    SELECT * INTO v_package FROM points_packages WHERE id = v_code_record.package_id;

    RETURN json_build_object(
        'valid', v_code_record.status = 'pending',
        'status', v_code_record.status,
        'package_name', v_package.name,
        'points', v_package.points_amount + COALESCE(v_package.bonus_points, 0),
        'expires_at', v_code_record.batch_expires_at
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 完成！请在 Supabase SQL Editor 中运行此脚本
-- ============================================
