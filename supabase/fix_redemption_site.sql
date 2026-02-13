-- ============================================
-- 修复: 兑换码生成函数添加 site 支持
-- 解决 CN 站点分析数据为空的问题
-- ============================================

-- ============================================
-- 1. 更新 fn_generate_codes - 添加 p_site 参数
-- ============================================
DROP FUNCTION IF EXISTS fn_generate_codes(VARCHAR, UUID, INT, VARCHAR, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION fn_generate_codes(
    p_batch_name VARCHAR,
    p_package_id UUID,
    p_count INT,
    p_channel VARCHAR DEFAULT 'manual',
    p_expires_at TIMESTAMPTZ DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS TABLE(code VARCHAR, batch_id UUID) AS $$
DECLARE
    v_batch_id UUID;
    v_code VARCHAR;
    v_chars VARCHAR := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
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

    -- 创建批次 (包含 site)
    INSERT INTO redemption_batches (name, package_id, channel, total_count, expires_at, created_by, site)
    VALUES (p_batch_name, p_package_id, p_channel, p_count, p_expires_at, auth.uid(), p_site)
    RETURNING id INTO v_batch_id;

    -- 生成兑换码
    FOR v_i IN 1..p_count LOOP
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

        -- 插入兑换码（包含 site）
        BEGIN
            INSERT INTO redemption_codes (code, batch_id, package_id, site)
            VALUES (v_code, v_batch_id, p_package_id, p_site);
            
            code := v_code;
            batch_id := v_batch_id;
            RETURN NEXT;
        EXCEPTION WHEN unique_violation THEN
            v_i := v_i - 1;
        END;
    END LOOP;

    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 2. 更新 fn_generate_custom_codes - 添加 p_site 参数
-- ============================================
DROP FUNCTION IF EXISTS fn_generate_custom_codes(TEXT, INTEGER, INTEGER, TEXT, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION fn_generate_custom_codes(
    p_batch_name TEXT,
    p_points_amount INTEGER,
    p_count INTEGER,
    p_channel TEXT DEFAULT 'manual',
    p_expires_at TIMESTAMPTZ DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS TABLE(code TEXT) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_batch_id UUID;
    v_code TEXT;
    i INTEGER;
BEGIN
    IF p_points_amount <= 0 THEN
        RAISE EXCEPTION 'Points amount must be positive';
    END IF;
    
    IF p_count <= 0 OR p_count > 1000 THEN
        RAISE EXCEPTION 'Count must be between 1 and 1000';
    END IF;

    -- 创建批次 (包含 site)
    INSERT INTO redemption_batches (
        name, package_id, channel, total_count, used_count,
        expires_at, custom_points_amount, site
    ) VALUES (
        p_batch_name, NULL, p_channel, p_count, 0,
        p_expires_at, p_points_amount, p_site
    ) RETURNING id INTO v_batch_id;

    -- 生成兑换码
    FOR i IN 1..p_count LOOP
        v_code := 'ZY-' || 
                  upper(substring(md5(random()::text) from 1 for 4)) || '-' ||
                  upper(substring(md5(random()::text) from 1 for 4)) || '-' ||
                  upper(substring(md5(random()::text) from 1 for 4));
        
        -- 插入兑换码 (包含 site)
        INSERT INTO redemption_codes (
            batch_id, code, status, expires_at, site
        ) VALUES (
            v_batch_id, v_code, 'unused', p_expires_at, p_site
        );
        
        RETURN QUERY SELECT v_code;
    END LOOP;
    
    RETURN;
END;
$$;

-- ============================================
-- 3. 确保 redemption_batches 和 redemption_codes 有 site 列
-- ============================================
ALTER TABLE redemption_batches ADD COLUMN IF NOT EXISTS site VARCHAR DEFAULT 'cn';
ALTER TABLE redemption_codes ADD COLUMN IF NOT EXISTS site VARCHAR DEFAULT 'cn';

-- ============================================
-- 4. 回填现有数据: 默认设为 'cn'
-- ============================================
UPDATE redemption_batches SET site = 'cn' WHERE site IS NULL;
UPDATE redemption_codes SET site = 'cn' WHERE site IS NULL;

-- ============================================
-- 5. 修复 get_channel_breakdown - 同时过滤批次和兑换码
-- ============================================
CREATE OR REPLACE FUNCTION get_channel_breakdown(p_site VARCHAR DEFAULT NULL)
RETURNS TABLE (
    channel TEXT,
    batch_count BIGINT,
    total_codes BIGINT,
    used_codes BIGINT,
    total_points BIGINT,
    redemption_rate NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(b.channel, '未分类')::TEXT AS channel,
        COUNT(DISTINCT b.id) AS batch_count,
        COUNT(c.id) AS total_codes,
        COUNT(c.id) FILTER (WHERE c.status = 'used') AS used_codes,
        COALESCE(SUM(pkg.points_amount) FILTER (WHERE c.status = 'used'), 0) AS total_points,
        ROUND(
            safe_divide(
                COUNT(c.id) FILTER (WHERE c.status = 'used')::NUMERIC,
                NULLIF(COUNT(c.id), 0)::NUMERIC
            ) * 100, 
            2
        ) AS redemption_rate
    FROM public.redemption_batches b
    LEFT JOIN public.redemption_codes c ON c.batch_id = b.id
    LEFT JOIN public.points_packages pkg ON b.package_id = pkg.id
    WHERE (p_site IS NULL OR b.site = p_site)
    GROUP BY COALESCE(b.channel, '未分类')
    ORDER BY total_points DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_channel_breakdown();

-- ============================================
-- 6. 权限
-- ============================================
GRANT EXECUTE ON FUNCTION fn_generate_codes(VARCHAR, UUID, INT, VARCHAR, TIMESTAMPTZ, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_generate_custom_codes(TEXT, INTEGER, INTEGER, TEXT, TIMESTAMPTZ, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_channel_breakdown(VARCHAR) TO authenticated;

-- ============================================
-- 完成！请在 Supabase SQL Editor 中执行本脚本
-- ============================================
