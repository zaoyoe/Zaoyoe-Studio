-- ============================================
-- 更新 fn_redeem_code 函数
-- 添加对单个兑换码独立有效期的检查
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
    v_effective_expires_at TIMESTAMPTZ;
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
    ELSIF v_code_record.status = 'disabled' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被禁用');
    END IF;

    -- 单独查询批次过期时间
    SELECT expires_at INTO v_batch_record FROM redemption_batches WHERE id = v_code_record.batch_id;
    
    -- 计算有效的过期时间（单个码的优先于批次的）
    v_effective_expires_at := COALESCE(v_code_record.expires_at, v_batch_record.expires_at);
    
    -- 检查过期
    IF v_effective_expires_at IS NOT NULL AND v_effective_expires_at < NOW() THEN
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
-- 请在 Supabase SQL Editor 中运行此脚本
-- ============================================
