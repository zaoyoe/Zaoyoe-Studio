-- ============================================
-- 增强版 V4: 查询兑换码/订单号状态（含使用者/撤销者/批次信息）
-- 修复：处理 RECORD 未赋值的情况
-- 新增：返回批次ID和批次名称
-- ============================================

CREATE OR REPLACE FUNCTION fn_check_code_status(
    p_code VARCHAR
)
RETURNS JSON AS $$
DECLARE
    v_code_record RECORD;
    v_package RECORD;
    v_input VARCHAR;
    v_is_code BOOLEAN;
    v_used_by_name TEXT;
    v_revoked_by_name TEXT;
BEGIN
    -- 标准化输入
    v_input := UPPER(TRIM(p_code));
    
    -- 自动识别：ZY- 开头为兑换码，否则为订单号
    v_is_code := v_input LIKE 'ZY-%';
    
    IF v_is_code THEN
        -- 按兑换码查询
        SELECT rc.*, rb.expires_at AS batch_expires_at, rb.name AS batch_name, rb.id AS batch_id
        INTO v_code_record
        FROM redemption_codes rc
        LEFT JOIN redemption_batches rb ON rc.batch_id = rb.id
        WHERE rc.code = v_input;
    ELSE
        -- 按外部订单号查询
        SELECT rc.*, rb.expires_at AS batch_expires_at, rb.name AS batch_name, rb.id AS batch_id
        INTO v_code_record
        FROM redemption_codes rc
        LEFT JOIN redemption_batches rb ON rc.batch_id = rb.id
        WHERE rc.external_order_id = v_input
        LIMIT 1;
    END IF;

    IF v_code_record IS NULL THEN
        IF v_is_code THEN
            RETURN json_build_object('valid', false, 'message', '无效的兑换码');
        ELSE
            RETURN json_build_object('valid', false, 'message', '未找到该订单号关联的兑换码');
        END IF;
    END IF;

    SELECT * INTO v_package FROM points_packages WHERE id = v_code_record.package_id;
    
    -- 获取使用者信息（直接赋值给 TEXT 变量，避免 RECORD 未赋值问题）
    v_used_by_name := NULL;
    IF v_code_record.used_by IS NOT NULL THEN
        SELECT COALESCE(username, email) INTO v_used_by_name 
        FROM profiles WHERE id = v_code_record.used_by;
    END IF;
    
    -- 获取撤销者信息
    v_revoked_by_name := NULL;
    IF v_code_record.revoked_by IS NOT NULL THEN
        SELECT COALESCE(username, email) INTO v_revoked_by_name 
        FROM profiles WHERE id = v_code_record.revoked_by;
    END IF;

    RETURN json_build_object(
        'valid', v_code_record.status = 'pending',
        'status', v_code_record.status,
        'code', v_code_record.code,
        'external_order_id', v_code_record.external_order_id,
        'package_name', COALESCE(v_package.name, '自定义积分'),
        'points', COALESCE(
            v_package.points_amount + COALESCE(v_package.bonus_points, 0),
            v_code_record.points_amount,
            v_code_record.points_granted
        ),
        'expires_at', v_code_record.batch_expires_at,
        'used_at', v_code_record.used_at,
        'used_by', v_used_by_name,
        'revoke_reason', v_code_record.revoke_reason,
        'revoked_at', v_code_record.revoked_at,
        'revoked_by', v_revoked_by_name,
        'query_type', CASE WHEN v_is_code THEN 'code' ELSE 'order' END,
        'batch_id', v_code_record.batch_id,
        'batch_name', v_code_record.batch_name
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 请在 Supabase SQL Editor 中运行此脚本
-- ============================================
