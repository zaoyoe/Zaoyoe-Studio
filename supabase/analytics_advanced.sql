-- ============================================
-- PHASE 10: ADVANCED ANALYTICS
-- 深度分析功能 SQL
-- ============================================

-- ============================================
-- 1. CONVERSION FUNNEL (解锁转化漏斗)
-- 访问 -> 浏览 -> 解锁
-- ============================================

CREATE OR REPLACE FUNCTION get_conversion_funnel(p_days INTEGER DEFAULT 30)
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
    SELECT COUNT(DISTINCT user_id) INTO v_total_visitors
    FROM public.user_login_history
    WHERE created_at >= v_start_date;

    -- Step 2: Users who viewed prompts (commented or unlocked)
    SELECT COUNT(DISTINCT user_id) INTO v_prompt_viewers
    FROM (
        SELECT user_id FROM public.prompt_comments WHERE created_at >= v_start_date
        UNION
        SELECT user_id FROM public.prompt_unlocks WHERE unlocked_at >= v_start_date
    ) viewers;

    -- Step 3: Users who unlocked content
    SELECT COUNT(DISTINCT user_id) INTO v_unlockers
    FROM public.prompt_unlocks
    WHERE unlocked_at >= v_start_date;

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

-- ============================================
-- 2. USER RETENTION COHORT (用户留存热力图)
-- 按注册周分组的留存率
-- ============================================

CREATE OR REPLACE FUNCTION get_retention_cohort(p_weeks INTEGER DEFAULT 8)
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
            user_id,
            date_trunc('week', created_at AT TIME ZONE 'Asia/Shanghai')::date as activity_week
        FROM public.user_login_history
        WHERE created_at >= NOW() - (p_weeks || ' weeks')::INTERVAL
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

-- ============================================
-- 3. POINTS FLOW (积分流向桑基图)
-- 收入来源 -> 用户 -> 消费去向
-- ============================================

CREATE OR REPLACE FUNCTION get_points_flow(p_days INTEGER DEFAULT 30)
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
    GROUP BY 2
    
    ORDER BY value DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. GEO DISTRIBUTION (地理分布)
-- 基于 IP 的省份分布
-- ============================================

CREATE OR REPLACE FUNCTION get_geo_distribution()
RETURNS TABLE (
    region TEXT,
    user_count BIGINT,
    percentage NUMERIC
) AS $$
DECLARE
    v_total BIGINT;
BEGIN
    -- Note: This requires IP geo data in user_login_history
    -- For now, return placeholder based on IP prefix patterns
    SELECT COUNT(DISTINCT user_id) INTO v_total FROM public.user_login_history;
    
    RETURN QUERY
    SELECT 
        '未知地区'::TEXT as region,
        v_total as user_count,
        100.0::NUMERIC as percentage;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- GRANT PERMISSIONS
-- ============================================

GRANT EXECUTE ON FUNCTION get_conversion_funnel(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_retention_cohort(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_points_flow(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_geo_distribution() TO authenticated;
