-- ============================================
-- 环比统计扩展
-- 为 KPI 卡片添加环比增长率
-- ============================================

CREATE OR REPLACE FUNCTION get_overview_stats_with_trend()
RETURNS JSONB AS $$
DECLARE
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::date;
    v_yesterday DATE := v_today - INTERVAL '1 day';
    v_week_ago DATE := v_today - INTERVAL '7 days';
    v_prev_week_start DATE := v_today - INTERVAL '14 days';
    v_month_ago DATE := v_today - INTERVAL '30 days';
    
    -- Current values
    v_dau INTEGER;
    v_mau INTEGER;
    v_new_users_week INTEGER;
    v_total_points BIGINT;
    v_total_comments INTEGER;
    
    -- Previous values for comparison
    v_dau_prev INTEGER;
    v_new_users_prev_week INTEGER;
    v_comments_prev_week INTEGER;
    v_comments_this_week INTEGER;
BEGIN
    -- DAU today
    SELECT COUNT(DISTINCT user_id) INTO v_dau
    FROM public.user_login_history
    WHERE get_local_date(created_at) = v_today;

    -- DAU yesterday (for DoD)
    SELECT COUNT(DISTINCT user_id) INTO v_dau_prev
    FROM public.user_login_history
    WHERE get_local_date(created_at) = v_yesterday;

    -- MAU
    SELECT COUNT(DISTINCT user_id) INTO v_mau
    FROM public.user_login_history
    WHERE get_local_date(created_at) >= v_month_ago;

    -- New users this week
    SELECT COUNT(*) INTO v_new_users_week
    FROM auth.users
    WHERE get_local_date(created_at) >= v_week_ago;

    -- New users previous week (for WoW)
    SELECT COUNT(*) INTO v_new_users_prev_week
    FROM auth.users
    WHERE get_local_date(created_at) >= v_prev_week_start
      AND get_local_date(created_at) < v_week_ago;

    -- Total points
    SELECT COALESCE(SUM(balance), 0) INTO v_total_points
    FROM public.user_points;

    -- Comments this week
    SELECT COUNT(*) INTO v_comments_this_week
    FROM public.prompt_comments
    WHERE get_local_date(created_at) >= v_week_ago;

    -- Comments previous week
    SELECT COUNT(*) INTO v_comments_prev_week
    FROM public.prompt_comments
    WHERE get_local_date(created_at) >= v_prev_week_start
      AND get_local_date(created_at) < v_week_ago;

    -- Total comments
    SELECT COUNT(*) INTO v_total_comments
    FROM public.prompt_comments;

    RETURN jsonb_build_object(
        'dau', COALESCE(v_dau, 0),
        'dau_prev', COALESCE(v_dau_prev, 0),
        'dau_growth', CASE 
            WHEN COALESCE(v_dau_prev, 0) = 0 THEN 0 
            ELSE ROUND(((v_dau - v_dau_prev)::NUMERIC / v_dau_prev) * 100, 1)
        END,
        'mau', COALESCE(v_mau, 0),
        'new_users_week', COALESCE(v_new_users_week, 0),
        'new_users_prev_week', COALESCE(v_new_users_prev_week, 0),
        'new_users_growth', CASE 
            WHEN COALESCE(v_new_users_prev_week, 0) = 0 THEN 0 
            ELSE ROUND(((v_new_users_week - v_new_users_prev_week)::NUMERIC / v_new_users_prev_week) * 100, 1)
        END,
        'total_points', COALESCE(v_total_points, 0),
        'total_comments', COALESCE(v_total_comments, 0),
        'comments_this_week', COALESCE(v_comments_this_week, 0),
        'comments_prev_week', COALESCE(v_comments_prev_week, 0),
        'comments_growth', CASE 
            WHEN COALESCE(v_comments_prev_week, 0) = 0 THEN 0 
            ELSE ROUND(((v_comments_this_week - v_comments_prev_week)::NUMERIC / v_comments_prev_week) * 100, 1)
        END,
        'generated_at', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_overview_stats_with_trend() TO authenticated;
