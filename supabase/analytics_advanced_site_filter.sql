-- ============================================
-- 高级分析 RPC 函数 - 站点过滤支持
-- 为 conversion_funnel / retention_cohort / points_flow 增加 p_site 参数
-- p_site = NULL 时返回所有站点数据
-- ============================================

-- ============================================
-- 1. CONVERSION FUNNEL (解锁转化漏斗)
-- ============================================

CREATE OR REPLACE FUNCTION get_conversion_funnel(p_days INTEGER DEFAULT 30, p_site VARCHAR DEFAULT NULL)
RETURNS TABLE (
    step_name TEXT,
    step_order INTEGER,
    user_count BIGINT,
    conversion_rate NUMERIC
) AS $$
DECLARE
    v_start_date TIMESTAMPTZ := NOW() - (p_days || ' days')::INTERVAL;
    v_total_visitors BIGINT;
    v_prompt_viewers BIGINT;
    v_unlockers BIGINT;
BEGIN
    -- Step 1: Total active users (logged in)
    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT user_id) INTO v_total_visitors
        FROM public.user_login_history
        WHERE created_at >= v_start_date;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_total_visitors
        FROM public.user_login_history
        WHERE created_at >= v_start_date AND site = p_site;
    END IF;

    -- Step 2: Users who viewed prompts (commented or unlocked)
    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT user_id) INTO v_prompt_viewers
        FROM (
            SELECT user_id FROM public.prompt_comments WHERE created_at >= v_start_date
            UNION
            SELECT user_id FROM public.prompt_unlocks WHERE unlocked_at >= v_start_date
        ) viewers;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_prompt_viewers
        FROM (
            SELECT user_id FROM public.prompt_comments WHERE created_at >= v_start_date AND site = p_site
            UNION
            SELECT user_id FROM public.prompt_unlocks WHERE unlocked_at >= v_start_date AND site = p_site
        ) viewers;
    END IF;

    -- Step 3: Users who unlocked content
    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT user_id) INTO v_unlockers
        FROM public.prompt_unlocks
        WHERE unlocked_at >= v_start_date;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_unlockers
        FROM public.prompt_unlocks
        WHERE unlocked_at >= v_start_date AND site = p_site;
    END IF;

    -- Return funnel data
    RETURN QUERY
    SELECT '访问用户'::TEXT, 1, COALESCE(v_total_visitors, 0), 100.0::NUMERIC
    UNION ALL
    SELECT '内容浏览'::TEXT, 2, COALESCE(v_prompt_viewers, 0), 
           ROUND(COALESCE(v_prompt_viewers, 0)::NUMERIC / NULLIF(v_total_visitors, 0) * 100, 1)
    UNION ALL
    SELECT '内容解锁'::TEXT, 3, COALESCE(v_unlockers, 0),
           ROUND(COALESCE(v_unlockers, 0)::NUMERIC / NULLIF(v_total_visitors, 0) * 100, 1)
    ORDER BY 2;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old signature
DROP FUNCTION IF EXISTS get_conversion_funnel(INTEGER);

-- ============================================
-- 2. USER RETENTION COHORT (用户留存热力图)
-- ============================================

CREATE OR REPLACE FUNCTION get_retention_cohort(p_weeks INTEGER DEFAULT 8, p_site VARCHAR DEFAULT NULL)
RETURNS TABLE (
    cohort_week TEXT,
    week_0 INTEGER,
    week_1 INTEGER,
    week_2 INTEGER,
    week_3 INTEGER,
    week_4 INTEGER
) AS $$
BEGIN
    RETURN QUERY
    WITH cohorts AS (
        SELECT 
            u.id as user_id,
            date_trunc('week', u.created_at AT TIME ZONE 'Asia/Shanghai')::date as cohort_date
        FROM auth.users u
        WHERE u.created_at >= NOW() - (p_weeks || ' weeks')::INTERVAL
    ),
    user_activity AS (
        SELECT DISTINCT
            ulh.user_id,
            date_trunc('week', ulh.created_at AT TIME ZONE 'Asia/Shanghai')::date as activity_week
        FROM public.user_login_history ulh
        WHERE ulh.created_at >= NOW() - (p_weeks || ' weeks')::INTERVAL
          AND (p_site IS NULL OR ulh.site = p_site)
    ),
    retention AS (
        SELECT
            c.cohort_date,
            COUNT(DISTINCT c.user_id) as cohort_size,
            COUNT(DISTINCT CASE WHEN ua.activity_week = c.cohort_date THEN c.user_id END) as w0,
            COUNT(DISTINCT CASE WHEN ua.activity_week = c.cohort_date + INTERVAL '1 week' THEN c.user_id END) as w1,
            COUNT(DISTINCT CASE WHEN ua.activity_week = c.cohort_date + INTERVAL '2 weeks' THEN c.user_id END) as w2,
            COUNT(DISTINCT CASE WHEN ua.activity_week = c.cohort_date + INTERVAL '3 weeks' THEN c.user_id END) as w3,
            COUNT(DISTINCT CASE WHEN ua.activity_week = c.cohort_date + INTERVAL '4 weeks' THEN c.user_id END) as w4
        FROM cohorts c
        LEFT JOIN user_activity ua ON c.user_id = ua.user_id
        GROUP BY c.cohort_date
        ORDER BY c.cohort_date DESC
        LIMIT 6
    )
    SELECT 
        to_char(cohort_date, 'MM/DD') as cohort_week,
        ROUND(w0::NUMERIC / NULLIF(cohort_size, 0) * 100)::INTEGER as week_0,
        ROUND(w1::NUMERIC / NULLIF(cohort_size, 0) * 100)::INTEGER as week_1,
        ROUND(w2::NUMERIC / NULLIF(cohort_size, 0) * 100)::INTEGER as week_2,
        ROUND(w3::NUMERIC / NULLIF(cohort_size, 0) * 100)::INTEGER as week_3,
        ROUND(w4::NUMERIC / NULLIF(cohort_size, 0) * 100)::INTEGER as week_4
    FROM retention;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old signature
DROP FUNCTION IF EXISTS get_retention_cohort(INTEGER);

-- ============================================
-- 3. POINTS FLOW (积分流向)
-- ============================================

DROP FUNCTION IF EXISTS get_points_flow(INTEGER, VARCHAR);

CREATE OR REPLACE FUNCTION get_points_flow(p_days INTEGER DEFAULT 30, p_site VARCHAR DEFAULT NULL)
RETURNS TABLE (
    source_node TEXT,
    target_node TEXT,
    value NUMERIC
) AS $$
DECLARE
    v_start_date TIMESTAMPTZ := NOW() - (p_days || ' days')::INTERVAL;
BEGIN
    RETURN QUERY
    -- Income sources
    SELECT 
        CASE 
            WHEN reason LIKE '%兑换码%' OR reason LIKE '%redeem%' THEN '兑换码'
            WHEN reason LIKE '%充值%' OR reason LIKE '%recharge%' THEN '充值'
            WHEN reason LIKE '%奖励%' OR reason LIKE '%reward%' THEN '系统奖励'
            ELSE '其他收入'
        END::TEXT as source_node,
        '用户余额'::TEXT as target_node,
        ROUND(ABS(SUM(amount)), 1)::NUMERIC as value
    FROM public.points_ledger
    WHERE created_at >= v_start_date AND amount > 0
      AND (p_site IS NULL OR site = p_site)
    GROUP BY 1
    
    UNION ALL
    
    -- Expense destinations
    SELECT 
        '用户余额'::TEXT as source_node,
        CASE 
            WHEN reason LIKE '%解锁%' OR reason LIKE '%unlock%' THEN '内容解锁'
            WHEN reason LIKE '%扣除%' OR reason LIKE '%deduct%' THEN '管理扣除'
            ELSE '其他消费'
        END::TEXT as target_node,
        ROUND(ABS(SUM(amount)), 1)::NUMERIC as value
    FROM public.points_ledger
    WHERE created_at >= v_start_date AND amount < 0
      AND (p_site IS NULL OR site = p_site)
    GROUP BY 2
    
    ORDER BY value DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old signature
DROP FUNCTION IF EXISTS get_points_flow(INTEGER);

-- ============================================
-- 4. REDEMPTION FUNNEL (兑换码漏斗 - 带站点过滤)
-- ============================================

CREATE OR REPLACE FUNCTION get_redemption_funnel(p_site VARCHAR DEFAULT NULL)
RETURNS TABLE (
    step TEXT,
    count BIGINT,
    conversion_rate NUMERIC
) AS $$
DECLARE
    v_generated BIGINT;
    v_redeemed BIGINT;
    v_users BIGINT;
BEGIN
    -- 1. Generated Codes
    IF p_site IS NULL THEN
        SELECT COUNT(*) INTO v_generated FROM public.redemption_codes;
    ELSE
        SELECT COUNT(*) INTO v_generated FROM public.redemption_codes WHERE site = p_site;
    END IF;
    
    -- 2. Redeemed Codes
    IF p_site IS NULL THEN
        SELECT COUNT(*) INTO v_redeemed FROM public.redemption_codes WHERE status = 'used';
    ELSE
        SELECT COUNT(*) INTO v_redeemed FROM public.redemption_codes WHERE status = 'used' AND site = p_site;
    END IF;
    
    -- 3. Users Redeemed (Unique)
    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT used_by) INTO v_users 
        FROM public.redemption_codes 
        WHERE status = 'used' AND used_by IS NOT NULL;
    ELSE
        SELECT COUNT(DISTINCT used_by) INTO v_users 
        FROM public.redemption_codes 
        WHERE status = 'used' AND used_by IS NOT NULL AND site = p_site;
    END IF;
    
    RETURN QUERY SELECT '已生成', v_generated, 100.0::NUMERIC;
    
    RETURN QUERY SELECT '已核销', v_redeemed, 
        CASE WHEN v_generated > 0 THEN ROUND((v_redeemed::NUMERIC / v_generated::NUMERIC) * 100, 2) ELSE 0 END;
        
    RETURN QUERY SELECT '核销人数', v_users, 
        CASE WHEN v_redeemed > 0 THEN ROUND((v_users::NUMERIC / v_redeemed::NUMERIC) * 100, 2) ELSE 0 END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old signature
DROP FUNCTION IF EXISTS get_redemption_funnel();

-- ============================================
-- 5. CHANNEL BREAKDOWN (渠道分布 - 带站点过滤)
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
        AND (p_site IS NULL OR c.site = p_site)
    LEFT JOIN public.points_packages pkg ON b.package_id = pkg.id
    GROUP BY COALESCE(b.channel, '未分类')
    ORDER BY total_points DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old signature
DROP FUNCTION IF EXISTS get_channel_breakdown();

-- ============================================
-- GRANT PERMISSIONS
-- ============================================

GRANT EXECUTE ON FUNCTION get_conversion_funnel(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_retention_cohort(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_points_flow(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_redemption_funnel(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_channel_breakdown(VARCHAR) TO authenticated;

-- ============================================
-- 完成！在 Supabase SQL Editor 中执行本脚本
-- ============================================
