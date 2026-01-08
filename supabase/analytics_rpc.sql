-- ============================================
-- ANALYTICS RPC FUNCTIONS
-- Phase 1: Core Statistics Functions
-- ============================================
-- NOTE: 用户创建时间使用 auth.users.created_at

-- ============================================
-- 1. OVERVIEW STATS
-- Returns key metrics for the dashboard header
-- ============================================

CREATE OR REPLACE FUNCTION get_overview_stats()
RETURNS JSONB AS $$
DECLARE
    v_dau INTEGER;
    v_mau INTEGER;
    v_new_users_today INTEGER;
    v_new_users_week INTEGER;
    v_total_points_circulation BIGINT;
    v_total_comments INTEGER;
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::date;
    v_week_ago DATE := v_today - INTERVAL '7 days';
    v_month_ago DATE := v_today - INTERVAL '30 days';
BEGIN
    -- DAU: Unique users who logged in today
    SELECT COUNT(DISTINCT user_id) INTO v_dau
    FROM public.user_login_history
    WHERE get_local_date(created_at) = v_today;

    -- MAU: Unique users who logged in last 30 days
    SELECT COUNT(DISTINCT user_id) INTO v_mau
    FROM public.user_login_history
    WHERE get_local_date(created_at) >= v_month_ago;

    -- New users today (from auth.users)
    SELECT COUNT(*) INTO v_new_users_today
    FROM auth.users
    WHERE get_local_date(created_at) = v_today;

    -- New users this week
    SELECT COUNT(*) INTO v_new_users_week
    FROM auth.users
    WHERE get_local_date(created_at) >= v_week_ago;

    -- Total points in circulation (sum of all balances)
    SELECT COALESCE(SUM(balance), 0) INTO v_total_points_circulation
    FROM public.user_points;

    -- Total comments (all time)
    SELECT COUNT(*) INTO v_total_comments
    FROM public.prompt_comments;

    RETURN jsonb_build_object(
        'dau', COALESCE(v_dau, 0),
        'mau', COALESCE(v_mau, 0),
        'new_users_today', COALESCE(v_new_users_today, 0),
        'new_users_week', COALESCE(v_new_users_week, 0),
        'total_points', COALESCE(v_total_points_circulation, 0),
        'total_comments', COALESCE(v_total_comments, 0),
        'generated_at', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 2. USER TREND
-- Returns daily user statistics for charts
-- ============================================

CREATE OR REPLACE FUNCTION get_user_trend(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
    stat_date DATE,
    new_users INTEGER,
    active_users INTEGER
) AS $$
DECLARE
    v_start_date DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::date - p_days;
BEGIN
    RETURN QUERY
    WITH date_series AS (
        SELECT generate_series(
            v_start_date,
            (NOW() AT TIME ZONE 'Asia/Shanghai')::date,
            INTERVAL '1 day'
        )::date AS d
    ),
    new_users_by_day AS (
        SELECT 
            get_local_date(created_at) AS d,
            COUNT(*)::INTEGER AS cnt
        FROM auth.users
        WHERE get_local_date(created_at) >= v_start_date
        GROUP BY 1
    ),
    active_users_by_day AS (
        SELECT 
            get_local_date(created_at) AS d,
            COUNT(DISTINCT user_id)::INTEGER AS cnt
        FROM public.user_login_history
        WHERE get_local_date(created_at) >= v_start_date
        GROUP BY 1
    )
    SELECT 
        ds.d AS stat_date,
        COALESCE(nu.cnt, 0) AS new_users,
        COALESCE(au.cnt, 0) AS active_users
    FROM date_series ds
    LEFT JOIN new_users_by_day nu ON nu.d = ds.d
    LEFT JOIN active_users_by_day au ON au.d = ds.d
    ORDER BY ds.d ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 3. CONTENT TREND
-- Returns daily content activity
-- ============================================

CREATE OR REPLACE FUNCTION get_content_trend(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
    stat_date DATE,
    comments INTEGER,
    unlocks INTEGER,
    likes INTEGER
) AS $$
DECLARE
    v_start_date DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::date - p_days;
BEGIN
    RETURN QUERY
    WITH date_series AS (
        SELECT generate_series(
            v_start_date,
            (NOW() AT TIME ZONE 'Asia/Shanghai')::date,
            INTERVAL '1 day'
        )::date AS d
    ),
    comments_by_day AS (
        SELECT 
            get_local_date(created_at) AS d,
            COUNT(*)::INTEGER AS cnt
        FROM public.prompt_comments
        WHERE get_local_date(created_at) >= v_start_date
        GROUP BY 1
    ),
    unlocks_by_day AS (
        SELECT 
            get_local_date(unlocked_at) AS d,
            COUNT(*)::INTEGER AS cnt
        FROM public.prompt_unlocks
        WHERE get_local_date(unlocked_at) >= v_start_date
        GROUP BY 1
    ),
    likes_by_day AS (
        SELECT 
            get_local_date(created_at) AS d,
            COUNT(*)::INTEGER AS cnt
        FROM public.comment_likes
        WHERE get_local_date(created_at) >= v_start_date
        GROUP BY 1
    )
    SELECT 
        ds.d AS stat_date,
        COALESCE(c.cnt, 0) AS comments,
        COALESCE(u.cnt, 0) AS unlocks,
        COALESCE(l.cnt, 0) AS likes
    FROM date_series ds
    LEFT JOIN comments_by_day c ON c.d = ds.d
    LEFT JOIN unlocks_by_day u ON u.d = ds.d
    LEFT JOIN likes_by_day l ON l.d = ds.d
    ORDER BY ds.d ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. REVENUE TREND
-- Returns daily points flow (in/out)
-- ============================================

CREATE OR REPLACE FUNCTION get_revenue_trend(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
    stat_date DATE,
    points_in BIGINT,
    points_out BIGINT,
    redemptions INTEGER
) AS $$
DECLARE
    v_start_date DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::date - p_days;
BEGIN
    RETURN QUERY
    WITH date_series AS (
        SELECT generate_series(
            v_start_date,
            (NOW() AT TIME ZONE 'Asia/Shanghai')::date,
            INTERVAL '1 day'
        )::date AS d
    ),
    ledger_by_day AS (
        SELECT 
            get_local_date(created_at) AS d,
            COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0)::BIGINT AS in_amt,
            COALESCE(ABS(SUM(amount) FILTER (WHERE amount < 0)), 0)::BIGINT AS out_amt
        FROM public.points_ledger
        WHERE get_local_date(created_at) >= v_start_date
        GROUP BY 1
    ),
    redemptions_by_day AS (
        SELECT 
            get_local_date(used_at) AS d,
            COUNT(*)::INTEGER AS cnt
        FROM public.redemption_codes
        WHERE used_at IS NOT NULL 
          AND get_local_date(used_at) >= v_start_date
        GROUP BY 1
    )
    SELECT 
        ds.d AS stat_date,
        COALESCE(l.in_amt, 0) AS points_in,
        COALESCE(l.out_amt, 0) AS points_out,
        COALESCE(r.cnt, 0) AS redemptions
    FROM date_series ds
    LEFT JOIN ledger_by_day l ON l.d = ds.d
    LEFT JOIN redemptions_by_day r ON r.d = ds.d
    ORDER BY ds.d ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5. CHANNEL BREAKDOWN
-- Returns performance by channel
-- ============================================

CREATE OR REPLACE FUNCTION get_channel_breakdown()
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
        COALESCE(b.channel, '未分类') AS channel,
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
    GROUP BY COALESCE(b.channel, '未分类')
    ORDER BY total_points DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 6. CONTENT TOP N
-- Returns most popular prompts
-- ============================================

CREATE OR REPLACE FUNCTION get_content_top(p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
    prompt_id BIGINT,
    title TEXT,
    unlock_count BIGINT,
    comment_count BIGINT,
    score NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id AS prompt_id,
        p.title,
        COUNT(DISTINCT u.id) AS unlock_count,
        COUNT(DISTINCT c.id) AS comment_count,
        -- Score: unlocks * 2 + comments (weighted)
        (COUNT(DISTINCT u.id) * 2 + COUNT(DISTINCT c.id))::NUMERIC AS score
    FROM public.prompts p
    LEFT JOIN public.prompt_unlocks u ON u.prompt_id = p.id
    LEFT JOIN public.prompt_comments c ON c.prompt_id = p.id
    GROUP BY p.id, p.title
    ORDER BY score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 7. HOURLY ACTIVITY HEATMAP
-- Returns activity by hour and day of week
-- ============================================

CREATE OR REPLACE FUNCTION get_activity_heatmap(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
    day_of_week INTEGER,  -- 0=Sunday, 6=Saturday
    hour_of_day INTEGER,  -- 0-23
    activity_count BIGINT
) AS $$
DECLARE
    v_start_date TIMESTAMPTZ := NOW() - (p_days || ' days')::INTERVAL;
BEGIN
    RETURN QUERY
    SELECT 
        EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Shanghai')::INTEGER AS day_of_week,
        EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Shanghai')::INTEGER AS hour_of_day,
        COUNT(*) AS activity_count
    FROM public.user_login_history
    WHERE created_at >= v_start_date
    GROUP BY 1, 2
    ORDER BY 1, 2;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 8. COMMUNITY STATS
-- Returns guestbook activity
-- ============================================

CREATE OR REPLACE FUNCTION get_community_stats(p_days INTEGER DEFAULT 30)
RETURNS TABLE (
    stat_date DATE,
    messages INTEGER,
    comments INTEGER,
    likes INTEGER
) AS $$
DECLARE
    v_start_date DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::date - p_days;
BEGIN
    RETURN QUERY
    WITH date_series AS (
        SELECT generate_series(
            v_start_date,
            (NOW() AT TIME ZONE 'Asia/Shanghai')::date,
            INTERVAL '1 day'
        )::date AS d
    ),
    messages_by_day AS (
        SELECT 
            get_local_date(created_at) AS d,
            COUNT(*)::INTEGER AS cnt
        FROM public.guestbook_messages
        WHERE get_local_date(created_at) >= v_start_date
        GROUP BY 1
    ),
    comments_by_day AS (
        SELECT 
            get_local_date(created_at) AS d,
            COUNT(*)::INTEGER AS cnt
        FROM public.guestbook_comments
        WHERE get_local_date(created_at) >= v_start_date
        GROUP BY 1
    ),
    likes_by_day AS (
        SELECT 
            get_local_date(created_at) AS d,
            COUNT(*)::INTEGER AS cnt
        FROM public.guestbook_likes
        WHERE get_local_date(created_at) >= v_start_date
        GROUP BY 1
    )
    SELECT 
        ds.d AS stat_date,
        COALESCE(m.cnt, 0) AS messages,
        COALESCE(c.cnt, 0) AS comments,
        COALESCE(l.cnt, 0) AS likes
    FROM date_series ds
    LEFT JOIN messages_by_day m ON m.d = ds.d
    LEFT JOIN comments_by_day c ON c.d = ds.d
    LEFT JOIN likes_by_day l ON l.d = ds.d
    ORDER BY ds.d ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 9. TOP CONTRIBUTORS
-- Returns most active users
-- ============================================

CREATE OR REPLACE FUNCTION get_top_contributors(p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
    user_id UUID,
    username TEXT,
    avatar_url TEXT,
    comment_count BIGINT,
    message_count BIGINT,
    total_likes_received BIGINT,
    contribution_score NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    WITH user_comments AS (
        SELECT pc.user_id, COUNT(*) AS cnt
        FROM public.prompt_comments pc
        GROUP BY pc.user_id
    ),
    user_messages AS (
        SELECT gm.user_id, COUNT(*) AS cnt
        FROM public.guestbook_messages gm
        GROUP BY gm.user_id
    ),
    user_likes AS (
        SELECT 
            CASE 
                WHEN l.target_type = 'message' THEN m.user_id
                ELSE gc.user_id
            END AS receiver_id,
            COUNT(*) AS cnt
        FROM public.guestbook_likes l
        LEFT JOIN public.guestbook_messages m ON l.target_type = 'message' AND l.target_id = m.id
        LEFT JOIN public.guestbook_comments gc ON l.target_type = 'comment' AND l.target_id = gc.id
        GROUP BY 1
    )
    SELECT 
        p.id AS user_id,
        p.username,
        p.avatar_url,
        COALESCE(uc.cnt, 0) AS comment_count,
        COALESCE(um.cnt, 0) AS message_count,
        COALESCE(ul.cnt, 0) AS total_likes_received,
        (COALESCE(uc.cnt, 0) + COALESCE(um.cnt, 0) * 2 + COALESCE(ul.cnt, 0) * 0.5)::NUMERIC AS contribution_score
    FROM public.profiles p
    LEFT JOIN user_comments uc ON uc.user_id = p.id
    LEFT JOIN user_messages um ON um.user_id = p.id
    LEFT JOIN user_likes ul ON ul.receiver_id = p.id
    WHERE COALESCE(uc.cnt, 0) + COALESCE(um.cnt, 0) > 0
    ORDER BY contribution_score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 10. AI SUMMARY DATA
-- Returns aggregated data for AI analysis
-- ============================================

CREATE OR REPLACE FUNCTION get_ai_summary_data(p_days INTEGER DEFAULT 7)
RETURNS JSONB AS $$
DECLARE
    v_overview JSONB;
    v_user_trend JSONB;
    v_channel_breakdown JSONB;
    v_top_content JSONB;
BEGIN
    -- Get overview
    SELECT get_overview_stats() INTO v_overview;

    -- Get user trend (simplified)
    SELECT jsonb_agg(t) INTO v_user_trend
    FROM (
        SELECT * FROM get_user_trend(p_days)
    ) t;

    -- Get channel breakdown
    SELECT jsonb_agg(t) INTO v_channel_breakdown
    FROM (
        SELECT * FROM get_channel_breakdown()
    ) t;

    -- Get top content
    SELECT jsonb_agg(t) INTO v_top_content
    FROM (
        SELECT * FROM get_content_top(5)
    ) t;

    RETURN jsonb_build_object(
        'period_days', p_days,
        'overview', v_overview,
        'user_trend', v_user_trend,
        'channel_breakdown', v_channel_breakdown,
        'top_content', v_top_content,
        'generated_at', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- GRANT PERMISSIONS
-- ============================================

GRANT EXECUTE ON FUNCTION get_overview_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_trend(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_content_trend(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_revenue_trend(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_channel_breakdown() TO authenticated;
GRANT EXECUTE ON FUNCTION get_content_top(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_activity_heatmap(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_community_stats(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_top_contributors(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ai_summary_data(INTEGER) TO authenticated;

-- ============================================
-- DONE! Run this in Supabase SQL Editor
-- after running analytics_infrastructure.sql
-- ============================================
