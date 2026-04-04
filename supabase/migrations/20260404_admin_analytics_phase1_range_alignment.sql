-- ============================================
-- 2026-04-04 Admin Analytics Phase 1 Range Alignment
-- 1. Align rolling windows to exact day counts
-- 2. Make top content/channel/redemption range-aware
-- 3. Fix comments growth to compare matched windows
-- 4. Mark conversion funnel as proxy-based
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
    v_week_start DATE := v_today - 6;
    v_month_start DATE := v_today - 29;
BEGIN
    PERFORM public.require_admin_access();

    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT user_id) INTO v_dau
        FROM public.user_login_history
        WHERE get_local_date(created_at) = v_today;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_dau
        FROM public.user_login_history
        WHERE get_local_date(created_at) = v_today AND site = p_site;
    END IF;

    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT user_id) INTO v_mau
        FROM public.user_login_history
        WHERE get_local_date(created_at) >= v_month_start;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_mau
        FROM public.user_login_history
        WHERE get_local_date(created_at) >= v_month_start AND site = p_site;
    END IF;

    SELECT COUNT(*) INTO v_new_users_today
    FROM auth.users
    WHERE get_local_date(created_at) = v_today;

    SELECT COUNT(*) INTO v_new_users_week
    FROM auth.users
    WHERE get_local_date(created_at) >= v_week_start;

    IF p_site IS NULL THEN
        SELECT COALESCE(SUM(total_balance), 0) INTO v_total_points_circulation
        FROM public.points_balance;
    ELSE
        SELECT COALESCE(SUM(total_balance), 0) INTO v_total_points_circulation
        FROM public.points_balance
        WHERE site = p_site;
    END IF;

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

CREATE OR REPLACE FUNCTION get_user_trend(p_days INTEGER DEFAULT 30, p_site VARCHAR DEFAULT NULL)
RETURNS TABLE (
    stat_date DATE,
    new_users INTEGER,
    active_users INTEGER
) AS $$
DECLARE
    v_start_date DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::date - GREATEST(p_days - 1, 0);
BEGIN
    PERFORM public.require_admin_access();

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

CREATE OR REPLACE FUNCTION get_content_trend(p_days INTEGER DEFAULT 30, p_site VARCHAR DEFAULT NULL)
RETURNS TABLE (
    stat_date DATE,
    comments INTEGER,
    unlocks INTEGER,
    likes INTEGER
) AS $$
DECLARE
    v_start_date DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::date - GREATEST(p_days - 1, 0);
BEGIN
    PERFORM public.require_admin_access();

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

CREATE OR REPLACE FUNCTION get_revenue_trend(p_days INTEGER DEFAULT 30, p_site VARCHAR DEFAULT NULL)
RETURNS TABLE (
    stat_date DATE,
    points_in BIGINT,
    points_out BIGINT,
    redemptions INTEGER
) AS $$
DECLARE
    v_start_date DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::date - GREATEST(p_days - 1, 0);
BEGIN
    PERFORM public.require_admin_access();

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

CREATE OR REPLACE FUNCTION get_content_top(
    p_limit INTEGER DEFAULT 10,
    p_site VARCHAR DEFAULT NULL,
    p_days INTEGER DEFAULT NULL
)
RETURNS TABLE (
    prompt_id BIGINT,
    title TEXT,
    unlock_count BIGINT,
    comment_count BIGINT,
    score NUMERIC
) AS $$
DECLARE
    v_start_date DATE := CASE
        WHEN p_days IS NOT NULL AND p_days > 0
            THEN (NOW() AT TIME ZONE 'Asia/Shanghai')::date - GREATEST(p_days - 1, 0)
        ELSE NULL
    END;
BEGIN
    PERFORM public.require_admin_access();

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
        AND (v_start_date IS NULL OR get_local_date(u.unlocked_at) >= v_start_date)
    LEFT JOIN public.prompt_comments c ON c.prompt_id = p.id
        AND (p_site IS NULL OR c.site = p_site)
        AND (v_start_date IS NULL OR get_local_date(c.created_at) >= v_start_date)
    GROUP BY p.id, p.title
    ORDER BY score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_content_top(INTEGER, VARCHAR);

CREATE OR REPLACE FUNCTION get_community_stats(p_days INTEGER DEFAULT 30, p_site VARCHAR DEFAULT NULL)
RETURNS TABLE (
    stat_date DATE,
    messages INTEGER,
    comments INTEGER,
    likes INTEGER
) AS $$
DECLARE
    v_start_date DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::date - GREATEST(p_days - 1, 0);
BEGIN
    PERFORM public.require_admin_access();

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

CREATE OR REPLACE FUNCTION get_ai_summary_data(p_days INTEGER DEFAULT 7, p_site VARCHAR DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_overview JSONB;
    v_user_trend JSONB;
    v_channel_breakdown JSONB;
    v_top_content JSONB;
BEGIN
    PERFORM public.require_admin_access();

    SELECT get_overview_stats(p_site) INTO v_overview;

    SELECT jsonb_agg(t) INTO v_user_trend
    FROM (SELECT * FROM get_user_trend(p_days, p_site)) t;

    SELECT jsonb_agg(t) INTO v_channel_breakdown
    FROM (SELECT * FROM get_channel_breakdown(p_site, p_days)) t;

    SELECT jsonb_agg(t) INTO v_top_content
    FROM (SELECT * FROM get_content_top(5, p_site, p_days)) t;

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

CREATE OR REPLACE FUNCTION get_overview_stats_with_trend(p_site VARCHAR DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_base JSONB;
    v_prev_dau INTEGER;
    v_prev_new_users INTEGER;
    v_current_comments INTEGER;
    v_prev_comments INTEGER;
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::date;
    v_yesterday DATE := v_today - 1;
    v_current_window_start DATE := v_today - 6;
    v_prev_window_start DATE := v_today - 13;
    v_prev_window_end DATE := v_today - 7;
BEGIN
    PERFORM public.require_admin_access();

    v_base := get_overview_stats(p_site);

    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT user_id) INTO v_prev_dau
        FROM public.user_login_history
        WHERE get_local_date(created_at) = v_yesterday;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_prev_dau
        FROM public.user_login_history
        WHERE get_local_date(created_at) = v_yesterday
          AND site = p_site;
    END IF;

    SELECT COUNT(*) INTO v_prev_new_users
    FROM auth.users
    WHERE get_local_date(created_at) BETWEEN v_prev_window_start AND v_prev_window_end;

    IF p_site IS NULL THEN
        SELECT COUNT(*) INTO v_current_comments
        FROM public.prompt_comments
        WHERE get_local_date(created_at) BETWEEN v_current_window_start AND v_today;
    ELSE
        SELECT COUNT(*) INTO v_current_comments
        FROM public.prompt_comments
        WHERE get_local_date(created_at) BETWEEN v_current_window_start AND v_today
          AND site = p_site;
    END IF;

    IF p_site IS NULL THEN
        SELECT COUNT(*) INTO v_prev_comments
        FROM public.prompt_comments
        WHERE get_local_date(created_at) BETWEEN v_prev_window_start AND v_prev_window_end;
    ELSE
        SELECT COUNT(*) INTO v_prev_comments
        FROM public.prompt_comments
        WHERE get_local_date(created_at) BETWEEN v_prev_window_start AND v_prev_window_end
          AND site = p_site;
    END IF;

    RETURN v_base || jsonb_build_object(
        'dau_growth', CASE WHEN v_prev_dau > 0 THEN ROUND(((v_base->>'dau')::NUMERIC - v_prev_dau) / v_prev_dau * 100) ELSE 0 END,
        'new_users_growth', CASE WHEN v_prev_new_users > 0 THEN ROUND(((v_base->>'new_users_week')::NUMERIC - v_prev_new_users) / v_prev_new_users * 100) ELSE 0 END,
        'comments_growth', CASE WHEN v_prev_comments > 0 THEN ROUND((COALESCE(v_current_comments, 0)::NUMERIC - v_prev_comments) / v_prev_comments * 100) ELSE 0 END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_conversion_funnel(INTEGER, VARCHAR);

CREATE OR REPLACE FUNCTION get_conversion_funnel(p_days INTEGER DEFAULT 30, p_site VARCHAR DEFAULT NULL)
RETURNS TABLE (
    step_name TEXT,
    step_order INTEGER,
    user_count BIGINT,
    conversion_rate NUMERIC,
    is_proxy_metric BOOLEAN
) AS $$
DECLARE
    v_start_date DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::date - GREATEST(p_days - 1, 0);
    v_total_visitors BIGINT;
    v_prompt_viewers BIGINT;
    v_unlockers BIGINT;
BEGIN
    PERFORM public.require_admin_access();

    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT user_id) INTO v_total_visitors
        FROM public.user_login_history
        WHERE get_local_date(created_at) >= v_start_date;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_total_visitors
        FROM public.user_login_history
        WHERE get_local_date(created_at) >= v_start_date AND site = p_site;
    END IF;

    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT user_id) INTO v_prompt_viewers
        FROM (
            SELECT user_id FROM public.prompt_comments WHERE get_local_date(created_at) >= v_start_date
            UNION
            SELECT user_id FROM public.prompt_unlocks WHERE get_local_date(unlocked_at) >= v_start_date
        ) viewers;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_prompt_viewers
        FROM (
            SELECT user_id FROM public.prompt_comments WHERE get_local_date(created_at) >= v_start_date AND site = p_site
            UNION
            SELECT user_id FROM public.prompt_unlocks WHERE get_local_date(unlocked_at) >= v_start_date AND site = p_site
        ) viewers;
    END IF;

    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT user_id) INTO v_unlockers
        FROM public.prompt_unlocks
        WHERE get_local_date(unlocked_at) >= v_start_date;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_unlockers
        FROM public.prompt_unlocks
        WHERE get_local_date(unlocked_at) >= v_start_date AND site = p_site;
    END IF;

    RETURN QUERY
    SELECT '访问用户'::TEXT, 1, COALESCE(v_total_visitors, 0), 100.0::NUMERIC, TRUE
    UNION ALL
    SELECT '内容浏览'::TEXT, 2, COALESCE(v_prompt_viewers, 0),
           ROUND(COALESCE(v_prompt_viewers, 0)::NUMERIC / NULLIF(v_total_visitors, 0) * 100, 1),
           TRUE
    UNION ALL
    SELECT '内容解锁'::TEXT, 3, COALESCE(v_unlockers, 0),
           ROUND(COALESCE(v_unlockers, 0)::NUMERIC / NULLIF(v_total_visitors, 0) * 100, 1),
           TRUE
    ORDER BY 2;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_points_flow(INTEGER, VARCHAR);

CREATE OR REPLACE FUNCTION get_points_flow(p_days INTEGER DEFAULT 30, p_site VARCHAR DEFAULT NULL)
RETURNS TABLE (
    source_node TEXT,
    target_node TEXT,
    value NUMERIC
) AS $$
DECLARE
    v_start_date DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::date - GREATEST(p_days - 1, 0);
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    SELECT
        CASE
            WHEN reason LIKE '%兑换码%' OR reason LIKE '%redeem%' THEN '兑换码'
            WHEN reason LIKE '%充值%' OR reason LIKE '%recharge%' THEN '充值'
            WHEN reason LIKE '%奖励%' OR reason LIKE '%reward%' THEN '系统奖励'
            ELSE '其他收入'
        END::TEXT AS source_node,
        '用户余额'::TEXT AS target_node,
        ROUND(ABS(SUM(amount)), 1)::NUMERIC AS value
    FROM public.points_ledger
    WHERE get_local_date(created_at) >= v_start_date AND amount > 0
      AND (p_site IS NULL OR site = p_site)
    GROUP BY 1

    UNION ALL

    SELECT
        '用户余额'::TEXT AS source_node,
        CASE
            WHEN reason LIKE '%解锁%' OR reason LIKE '%unlock%' THEN '内容解锁'
            WHEN reason LIKE '%扣除%' OR reason LIKE '%deduct%' THEN '管理扣除'
            ELSE '其他消费'
        END::TEXT AS target_node,
        ROUND(ABS(SUM(amount)), 1)::NUMERIC AS value
    FROM public.points_ledger
    WHERE get_local_date(created_at) >= v_start_date AND amount < 0
      AND (p_site IS NULL OR site = p_site)
    GROUP BY 2

    ORDER BY value DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_points_flow(INTEGER);

CREATE OR REPLACE FUNCTION get_redemption_funnel(
    p_site VARCHAR DEFAULT NULL,
    p_days INTEGER DEFAULT NULL
)
RETURNS TABLE (
    step TEXT,
    count BIGINT,
    conversion_rate NUMERIC
) AS $$
DECLARE
    v_generated BIGINT;
    v_redeemed BIGINT;
    v_users BIGINT;
    v_start_date DATE := CASE
        WHEN p_days IS NOT NULL AND p_days > 0
            THEN (NOW() AT TIME ZONE 'Asia/Shanghai')::date - GREATEST(p_days - 1, 0)
        ELSE NULL
    END;
BEGIN
    PERFORM public.require_admin_access();

    IF p_site IS NULL THEN
        SELECT COUNT(*) INTO v_generated
        FROM public.redemption_codes
        WHERE v_start_date IS NULL OR get_local_date(created_at) >= v_start_date;
    ELSE
        SELECT COUNT(*) INTO v_generated
        FROM public.redemption_codes
        WHERE site = p_site
          AND (v_start_date IS NULL OR get_local_date(created_at) >= v_start_date);
    END IF;

    IF p_site IS NULL THEN
        SELECT COUNT(*) INTO v_redeemed
        FROM public.redemption_codes
        WHERE status = 'used'
          AND (v_start_date IS NULL OR get_local_date(created_at) >= v_start_date);
    ELSE
        SELECT COUNT(*) INTO v_redeemed
        FROM public.redemption_codes
        WHERE status = 'used'
          AND site = p_site
          AND (v_start_date IS NULL OR get_local_date(created_at) >= v_start_date);
    END IF;

    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT used_by) INTO v_users
        FROM public.redemption_codes
        WHERE status = 'used'
          AND used_by IS NOT NULL
          AND (v_start_date IS NULL OR get_local_date(created_at) >= v_start_date);
    ELSE
        SELECT COUNT(DISTINCT used_by) INTO v_users
        FROM public.redemption_codes
        WHERE status = 'used'
          AND used_by IS NOT NULL
          AND site = p_site
          AND (v_start_date IS NULL OR get_local_date(created_at) >= v_start_date);
    END IF;

    RETURN QUERY SELECT '已生成', v_generated, 100.0::NUMERIC;

    RETURN QUERY SELECT '已核销', v_redeemed,
        CASE WHEN v_generated > 0 THEN ROUND((v_redeemed::NUMERIC / v_generated::NUMERIC) * 100, 2) ELSE 0 END;

    RETURN QUERY SELECT '核销人数', v_users,
        CASE WHEN v_redeemed > 0 THEN ROUND((v_users::NUMERIC / v_redeemed::NUMERIC) * 100, 2) ELSE 0 END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_redemption_funnel(VARCHAR);

CREATE OR REPLACE FUNCTION get_channel_breakdown(
    p_site VARCHAR DEFAULT NULL,
    p_days INTEGER DEFAULT NULL
)
RETURNS TABLE (
    channel TEXT,
    batch_count BIGINT,
    total_codes BIGINT,
    used_codes BIGINT,
    total_points BIGINT,
    redemption_rate NUMERIC
) AS $$
DECLARE
    v_start_date DATE := CASE
        WHEN p_days IS NOT NULL AND p_days > 0
            THEN (NOW() AT TIME ZONE 'Asia/Shanghai')::date - GREATEST(p_days - 1, 0)
        ELSE NULL
    END;
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    SELECT
        COALESCE(b.channel, '未分类')::TEXT AS channel,
        COUNT(DISTINCT b.id) FILTER (WHERE c.id IS NOT NULL) AS batch_count,
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
        AND (v_start_date IS NULL OR get_local_date(c.created_at) >= v_start_date)
    LEFT JOIN public.points_packages pkg ON b.package_id = pkg.id
    GROUP BY COALESCE(b.channel, '未分类')
    ORDER BY total_points DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_channel_breakdown(VARCHAR);

GRANT EXECUTE ON FUNCTION get_overview_stats(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_trend(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_content_trend(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_revenue_trend(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_content_top(INTEGER, VARCHAR, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_community_stats(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ai_summary_data(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_overview_stats_with_trend(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_conversion_funnel(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_points_flow(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_redemption_funnel(VARCHAR, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_channel_breakdown(VARCHAR, INTEGER) TO authenticated;
