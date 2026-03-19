-- ============================================
-- 数据分析 RPC 函数 - 站点过滤支持
-- 为所有分析函数增加 p_site 参数
-- p_site = NULL 时返回所有站点数据
-- ============================================

-- ============================================
-- 1. OVERVIEW STATS (带站点过滤)
-- ============================================

CREATE OR REPLACE FUNCTION get_overview_stats(p_site VARCHAR DEFAULT NULL)
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
    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT user_id) INTO v_dau
        FROM public.user_login_history
        WHERE get_local_date(created_at) = v_today;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_dau
        FROM public.user_login_history
        WHERE get_local_date(created_at) = v_today AND site = p_site;
    END IF;

    -- MAU: Unique users who logged in last 30 days
    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT user_id) INTO v_mau
        FROM public.user_login_history
        WHERE get_local_date(created_at) >= v_month_ago;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_mau
        FROM public.user_login_history
        WHERE get_local_date(created_at) >= v_month_ago AND site = p_site;
    END IF;

    -- New users today (auth.users has no site column, shared)
    SELECT COUNT(*) INTO v_new_users_today
    FROM auth.users
    WHERE get_local_date(created_at) = v_today;

    -- New users this week
    SELECT COUNT(*) INTO v_new_users_week
    FROM auth.users
    WHERE get_local_date(created_at) >= v_week_ago;

    -- Total points in circulation
    IF p_site IS NULL THEN
        SELECT COALESCE(SUM(total_balance), 0) INTO v_total_points_circulation
        FROM public.points_balance;
    ELSE
        SELECT COALESCE(SUM(total_balance), 0) INTO v_total_points_circulation
        FROM public.points_balance WHERE site = p_site;
    END IF;

    -- Total comments (all time)
    IF p_site IS NULL THEN
        SELECT COUNT(*) INTO v_total_comments FROM public.prompt_comments;
    ELSE
        SELECT COUNT(*) INTO v_total_comments FROM public.prompt_comments WHERE site = p_site;
    END IF;

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

-- Drop old signature
DROP FUNCTION IF EXISTS get_overview_stats();

-- ============================================
-- 2. USER TREND (带站点过滤)
-- ============================================

CREATE OR REPLACE FUNCTION get_user_trend(p_days INTEGER DEFAULT 30, p_site VARCHAR DEFAULT NULL)
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
          AND (p_site IS NULL OR site = p_site)
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

-- Drop old signature
DROP FUNCTION IF EXISTS get_user_trend(INTEGER);

-- ============================================
-- 3. CONTENT TREND (带站点过滤)
-- ============================================

CREATE OR REPLACE FUNCTION get_content_trend(p_days INTEGER DEFAULT 30, p_site VARCHAR DEFAULT NULL)
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
          AND (p_site IS NULL OR site = p_site)
        GROUP BY 1
    ),
    unlocks_by_day AS (
        SELECT 
            get_local_date(unlocked_at) AS d,
            COUNT(*)::INTEGER AS cnt
        FROM public.prompt_unlocks
        WHERE get_local_date(unlocked_at) >= v_start_date
          AND (p_site IS NULL OR site = p_site)
        GROUP BY 1
    ),
    likes_by_day AS (
        SELECT 
            get_local_date(created_at) AS d,
            COUNT(*)::INTEGER AS cnt
        FROM public.comment_likes
        WHERE get_local_date(created_at) >= v_start_date
          AND (p_site IS NULL OR site = p_site)
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

-- Drop old signature
DROP FUNCTION IF EXISTS get_content_trend(INTEGER);

-- ============================================
-- 4. REVENUE TREND (带站点过滤)
-- ============================================

CREATE OR REPLACE FUNCTION get_revenue_trend(p_days INTEGER DEFAULT 30, p_site VARCHAR DEFAULT NULL)
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
          AND (p_site IS NULL OR site = p_site)
        GROUP BY 1
    ),
    redemptions_by_day AS (
        SELECT 
            get_local_date(used_at) AS d,
            COUNT(*)::INTEGER AS cnt
        FROM public.redemption_codes
        WHERE used_at IS NOT NULL 
          AND get_local_date(used_at) >= v_start_date
          AND (p_site IS NULL OR site = p_site)
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

-- Drop old signature
DROP FUNCTION IF EXISTS get_revenue_trend(INTEGER);

-- ============================================
-- 5. CONTENT TOP N (带站点过滤)
-- ============================================

CREATE OR REPLACE FUNCTION get_content_top(p_limit INTEGER DEFAULT 10, p_site VARCHAR DEFAULT NULL)
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
        (COUNT(DISTINCT u.id) * 2 + COUNT(DISTINCT c.id))::NUMERIC AS score
    FROM public.prompts p
    LEFT JOIN public.prompt_unlocks u ON u.prompt_id = p.id
        AND (p_site IS NULL OR u.site = p_site)
    LEFT JOIN public.prompt_comments c ON c.prompt_id = p.id
        AND (p_site IS NULL OR c.site = p_site)
    GROUP BY p.id, p.title
    ORDER BY score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old signature
DROP FUNCTION IF EXISTS get_content_top(INTEGER);

-- ============================================
-- 6. COMMUNITY STATS (带站点过滤)
-- ============================================

CREATE OR REPLACE FUNCTION get_community_stats(p_days INTEGER DEFAULT 30, p_site VARCHAR DEFAULT NULL)
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
          AND (p_site IS NULL OR site = p_site)
        GROUP BY 1
    ),
    comments_by_day AS (
        SELECT 
            get_local_date(created_at) AS d,
            COUNT(*)::INTEGER AS cnt
        FROM public.guestbook_comments
        WHERE get_local_date(created_at) >= v_start_date
          AND (p_site IS NULL OR site = p_site)
        GROUP BY 1
    ),
    likes_by_day AS (
        SELECT 
            get_local_date(created_at) AS d,
            COUNT(*)::INTEGER AS cnt
        FROM public.guestbook_likes
        WHERE get_local_date(created_at) >= v_start_date
          AND (p_site IS NULL OR site = p_site)
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

-- Drop old signature
DROP FUNCTION IF EXISTS get_community_stats(INTEGER);

-- ============================================
-- 7. ACTIVITY HEATMAP (带站点过滤)
-- ============================================

CREATE OR REPLACE FUNCTION get_activity_heatmap(p_days INTEGER DEFAULT 30, p_site VARCHAR DEFAULT NULL)
RETURNS TABLE (
    day_of_week INTEGER,
    hour_of_day INTEGER,
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
      AND (p_site IS NULL OR site = p_site)
    GROUP BY 1, 2
    ORDER BY 1, 2;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old signature
DROP FUNCTION IF EXISTS get_activity_heatmap(INTEGER);

-- ============================================
-- 8. TOP CONTRIBUTORS (带站点过滤)
-- ============================================

CREATE OR REPLACE FUNCTION get_top_contributors(p_limit INTEGER DEFAULT 10, p_site VARCHAR DEFAULT NULL)
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
        WHERE (p_site IS NULL OR pc.site = p_site)
        GROUP BY pc.user_id
    ),
    user_messages AS (
        SELECT gm.user_id, COUNT(*) AS cnt
        FROM public.guestbook_messages gm
        WHERE (p_site IS NULL OR gm.site = p_site)
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
        WHERE (p_site IS NULL OR l.site = p_site)
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

-- Drop old signature
DROP FUNCTION IF EXISTS get_top_contributors(INTEGER);

-- ============================================
-- 9. POINTS LEADERBOARD (带站点过滤)
-- ============================================

CREATE OR REPLACE FUNCTION get_points_leaderboard(p_limit INTEGER DEFAULT 10, p_site VARCHAR DEFAULT NULL)
RETURNS TABLE (
    user_id UUID,
    username TEXT,
    avatar_url TEXT,
    balance NUMERIC,
    total_spent NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pb.user_id,
        p.username,
        p.avatar_url,
        ROUND(COALESCE(SUM(pb.total_balance), 0), 1)::NUMERIC AS balance,
        COALESCE(
            (SELECT ABS(SUM(amount)) FROM public.points_ledger pl 
             WHERE pl.user_id = pb.user_id AND pl.amount < 0
               AND (p_site IS NULL OR pl.site = p_site)), 0
        )::NUMERIC AS total_spent
    FROM public.points_balance pb
    LEFT JOIN public.profiles p ON p.id = pb.user_id
    WHERE (p_site IS NULL OR pb.site = p_site)
    GROUP BY pb.user_id, p.username, p.avatar_url
    ORDER BY balance DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old signature
DROP FUNCTION IF EXISTS get_points_leaderboard(INTEGER);

-- ============================================
-- 10. POINTS HEALTH (带站点过滤)
-- ============================================

CREATE OR REPLACE FUNCTION get_points_health(p_site VARCHAR DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_users_with_points BIGINT;
    v_hoarding_users BIGINT;
    v_total_circulation NUMERIC(12,1);
    v_monthly_spend NUMERIC(12,1);
    v_weekly_income NUMERIC(12,1);
    v_weekly_spend NUMERIC(12,1);
    v_velocity NUMERIC;
    v_hoarding_rate NUMERIC;
    v_30_days_ago TIMESTAMP := NOW() - INTERVAL '30 days';
    v_7_days_ago TIMESTAMP := NOW() - INTERVAL '7 days';
BEGIN
    -- Total circulation
    IF p_site IS NULL THEN
        SELECT COALESCE(SUM(total_balance), 0) INTO v_total_circulation FROM public.points_balance;
    ELSE
        SELECT COALESCE(SUM(total_balance), 0) INTO v_total_circulation FROM public.points_balance WHERE site = p_site;
    END IF;
    
    -- Monthly spend
    IF p_site IS NULL THEN
        SELECT COALESCE(ABS(SUM(amount)), 0) INTO v_monthly_spend
        FROM public.points_ledger WHERE amount < 0 AND created_at >= v_30_days_ago;
    ELSE
        SELECT COALESCE(ABS(SUM(amount)), 0) INTO v_monthly_spend
        FROM public.points_ledger WHERE amount < 0 AND created_at >= v_30_days_ago AND site = p_site;
    END IF;

    -- Weekly income / spend
    IF p_site IS NULL THEN
        SELECT COALESCE(SUM(amount), 0) INTO v_weekly_income
        FROM public.points_ledger WHERE amount > 0 AND created_at >= v_7_days_ago;

        SELECT COALESCE(ABS(SUM(amount)), 0) INTO v_weekly_spend
        FROM public.points_ledger WHERE amount < 0 AND created_at >= v_7_days_ago;
    ELSE
        SELECT COALESCE(SUM(amount), 0) INTO v_weekly_income
        FROM public.points_ledger WHERE amount > 0 AND created_at >= v_7_days_ago AND site = p_site;

        SELECT COALESCE(ABS(SUM(amount)), 0) INTO v_weekly_spend
        FROM public.points_ledger WHERE amount < 0 AND created_at >= v_7_days_ago AND site = p_site;
    END IF;
    
    -- Velocity
    IF v_total_circulation > 0 THEN
        v_velocity := ROUND((v_monthly_spend::NUMERIC / v_total_circulation::NUMERIC) * 100, 2);
    ELSE
        v_velocity := 0;
    END IF;

    -- Hoarding
    IF p_site IS NULL THEN
        SELECT COUNT(*) INTO v_users_with_points FROM public.points_balance WHERE total_balance > 0;
        SELECT COUNT(*) INTO v_hoarding_users
        FROM public.points_balance pb
        WHERE pb.total_balance > 0
        AND NOT EXISTS (
            SELECT 1 FROM public.points_ledger pl
            WHERE pl.user_id = pb.user_id AND pl.amount < 0 AND pl.created_at >= v_30_days_ago
        );
    ELSE
        SELECT COUNT(*) INTO v_users_with_points FROM public.points_balance WHERE total_balance > 0 AND site = p_site;
        SELECT COUNT(*) INTO v_hoarding_users
        FROM public.points_balance pb
        WHERE pb.total_balance > 0 AND pb.site = p_site
        AND NOT EXISTS (
            SELECT 1 FROM public.points_ledger pl
            WHERE pl.user_id = pb.user_id AND pl.amount < 0 AND pl.created_at >= v_30_days_ago
              AND pl.site = p_site
        );
    END IF;

    IF v_users_with_points > 0 THEN
        v_hoarding_rate := ROUND((v_hoarding_users::NUMERIC / v_users_with_points::NUMERIC) * 100, 2);
    ELSE
        v_hoarding_rate := 0;
    END IF;

    RETURN jsonb_build_object(
        'total_circulation', v_total_circulation,
        'monthly_spend', v_monthly_spend,
        'weekly_income', COALESCE(v_weekly_income, 0),
        'weekly_spend', COALESCE(v_weekly_spend, 0),
        'velocity', v_velocity,
        'hoarding_rate', v_hoarding_rate,
        'active_holders', v_users_with_points,
        'hoarding_users', v_hoarding_users
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old signature
DROP FUNCTION IF EXISTS get_points_health();

-- ============================================
-- 11. POINTS DISTRIBUTION (带站点过滤)
-- ============================================

CREATE OR REPLACE FUNCTION get_points_distribution(p_site VARCHAR DEFAULT NULL)
RETURNS TABLE (
    range_label TEXT,
    user_count BIGINT,
    sort_order INTEGER
) AS $$
BEGIN
    RETURN QUERY
    WITH all_ranges AS (
        SELECT '0'::TEXT AS range_group, 1 AS order_rank, 0 AS min_val, 0 AS max_val
        UNION ALL SELECT '1-9', 2, 1, 9
        UNION ALL SELECT '10-49', 3, 10, 49
        UNION ALL SELECT '50-99', 4, 50, 99
        UNION ALL SELECT '100-499', 5, 100, 499
        UNION ALL SELECT '500-999', 6, 500, 999
        UNION ALL SELECT '1k-5k', 7, 1000, 4999
        UNION ALL SELECT '5k-10k', 8, 5000, 9999
        UNION ALL SELECT '10k+', 9, 10000, 999999999
    ),
    user_ranges AS (
        SELECT 
            CASE 
                WHEN total_balance = 0 THEN '0'
                WHEN total_balance BETWEEN 1 AND 9 THEN '1-9'
                WHEN total_balance BETWEEN 10 AND 49 THEN '10-49'
                WHEN total_balance BETWEEN 50 AND 99 THEN '50-99'
                WHEN total_balance BETWEEN 100 AND 499 THEN '100-499'
                WHEN total_balance BETWEEN 500 AND 999 THEN '500-999'
                WHEN total_balance BETWEEN 1000 AND 4999 THEN '1k-5k'
                WHEN total_balance BETWEEN 5000 AND 9999 THEN '5k-10k'
                WHEN total_balance >= 10000 THEN '10k+'
            END AS range_group,
            1 AS cnt
        FROM public.points_balance
        WHERE total_balance IS NOT NULL
          AND (p_site IS NULL OR site = p_site)
    )
    SELECT 
        ar.range_group,
        COALESCE(COUNT(ur.cnt), 0)::BIGINT AS user_count,
        ar.order_rank::INTEGER
    FROM all_ranges ar
    LEFT JOIN user_ranges ur ON ar.range_group = ur.range_group
    GROUP BY ar.range_group, ar.order_rank
    ORDER BY ar.order_rank;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old signature
DROP FUNCTION IF EXISTS get_points_distribution();

-- ============================================
-- 12. AI SUMMARY DATA (带站点过滤)
-- ============================================

CREATE OR REPLACE FUNCTION get_ai_summary_data(p_days INTEGER DEFAULT 7, p_site VARCHAR DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_overview JSONB;
    v_user_trend JSONB;
    v_channel_breakdown JSONB;
    v_top_content JSONB;
BEGIN
    SELECT get_overview_stats(p_site) INTO v_overview;

    SELECT jsonb_agg(t) INTO v_user_trend
    FROM (SELECT * FROM get_user_trend(p_days, p_site)) t;

    SELECT jsonb_agg(t) INTO v_channel_breakdown
    FROM (SELECT * FROM get_channel_breakdown(p_site)) t;

    SELECT jsonb_agg(t) INTO v_top_content
    FROM (SELECT * FROM get_content_top(5, p_site)) t;

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

-- Drop old signature
DROP FUNCTION IF EXISTS get_ai_summary_data(INTEGER);

-- ============================================
-- OVERVIEW WITH TREND (带站点过滤)
-- ============================================

CREATE OR REPLACE FUNCTION get_overview_stats_with_trend(p_site VARCHAR DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_base JSONB;
    v_prev_dau INTEGER;
    v_prev_new_users INTEGER;
    v_prev_comments INTEGER;
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::date;
    v_yesterday DATE := v_today - 1;
    v_prev_week DATE := v_today - 7;
BEGIN
    v_base := get_overview_stats(p_site);

    -- Previous DAU
    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT user_id) INTO v_prev_dau
        FROM public.user_login_history WHERE get_local_date(created_at) = v_yesterday;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_prev_dau
        FROM public.user_login_history WHERE get_local_date(created_at) = v_yesterday AND site = p_site;
    END IF;

    -- Previous week new users
    SELECT COUNT(*) INTO v_prev_new_users
    FROM auth.users WHERE get_local_date(created_at) BETWEEN (v_prev_week - 7) AND (v_prev_week - 1);

    -- Previous comments
    IF p_site IS NULL THEN
        SELECT COUNT(*) INTO v_prev_comments
        FROM public.prompt_comments WHERE get_local_date(created_at) BETWEEN (v_prev_week - 7) AND (v_prev_week - 1);
    ELSE
        SELECT COUNT(*) INTO v_prev_comments
        FROM public.prompt_comments WHERE get_local_date(created_at) BETWEEN (v_prev_week - 7) AND (v_prev_week - 1) AND site = p_site;
    END IF;

    RETURN v_base || jsonb_build_object(
        'dau_growth', CASE WHEN v_prev_dau > 0 THEN ROUND(((v_base->>'dau')::NUMERIC - v_prev_dau) / v_prev_dau * 100) ELSE 0 END,
        'new_users_growth', CASE WHEN v_prev_new_users > 0 THEN ROUND(((v_base->>'new_users_week')::NUMERIC - v_prev_new_users) / v_prev_new_users * 100) ELSE 0 END,
        'comments_growth', CASE WHEN v_prev_comments > 0 THEN ROUND(((v_base->>'total_comments')::NUMERIC - v_prev_comments) / v_prev_comments * 100) ELSE 0 END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old signature
DROP FUNCTION IF EXISTS get_overview_stats_with_trend();

-- ============================================
-- GRANT PERMISSIONS
-- ============================================

GRANT EXECUTE ON FUNCTION get_overview_stats(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_overview_stats_with_trend(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_trend(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_content_trend(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_revenue_trend(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_content_top(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_community_stats(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_activity_heatmap(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_top_contributors(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_points_leaderboard(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_points_health(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_points_distribution(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ai_summary_data(INTEGER, VARCHAR) TO authenticated;

-- ============================================
-- 完成！在 Supabase SQL Editor 中执行本脚本
-- ============================================
