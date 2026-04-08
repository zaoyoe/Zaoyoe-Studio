-- ============================================
-- 2026-04-05 Admin Analytics Explicit Range Dates
-- 1. Add p_start_date / p_end_date to analytics range RPCs
-- 2. Keep legacy p_days behavior as fallback
-- 3. Align event/channel/content/points/redemption range filtering
-- ============================================

DROP FUNCTION IF EXISTS get_user_trend(INTEGER, VARCHAR);
CREATE OR REPLACE FUNCTION get_user_trend(
    p_days INTEGER DEFAULT 30,
    p_site VARCHAR DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    stat_date DATE,
    new_users INTEGER,
    active_users INTEGER
) AS $$
DECLARE
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
    v_start_date DATE := COALESCE(p_start_date, v_end_date - GREATEST(COALESCE(p_days, 30) - 1, 0));
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    WITH date_series AS (
        SELECT generate_series(v_start_date, v_end_date, INTERVAL '1 day')::date AS d
    ),
    new_users_by_day AS (
        SELECT get_local_date(created_at) AS d, COUNT(*)::INTEGER AS cnt
        FROM auth.users
        WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date
        GROUP BY 1
    ),
    active_users_by_day AS (
        SELECT get_local_date(created_at) AS d, COUNT(DISTINCT user_id)::INTEGER AS cnt
        FROM public.user_login_history
        WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date
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

DROP FUNCTION IF EXISTS get_content_trend(INTEGER, VARCHAR);
CREATE OR REPLACE FUNCTION get_content_trend(
    p_days INTEGER DEFAULT 30,
    p_site VARCHAR DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    stat_date DATE,
    comments INTEGER,
    unlocks INTEGER,
    likes INTEGER
) AS $$
DECLARE
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
    v_start_date DATE := COALESCE(p_start_date, v_end_date - GREATEST(COALESCE(p_days, 30) - 1, 0));
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    WITH date_series AS (
        SELECT generate_series(v_start_date, v_end_date, INTERVAL '1 day')::date AS d
    ),
    comments_by_day AS (
        SELECT get_local_date(created_at) AS d, COUNT(*)::INTEGER AS cnt
        FROM public.prompt_comments
        WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date
          AND (p_site IS NULL OR site = p_site)
        GROUP BY 1
    ),
    unlocks_by_day AS (
        SELECT get_local_date(unlocked_at) AS d, COUNT(*)::INTEGER AS cnt
        FROM public.prompt_unlocks
        WHERE get_local_date(unlocked_at) BETWEEN v_start_date AND v_end_date
          AND (p_site IS NULL OR site = p_site)
        GROUP BY 1
    ),
    likes_by_day AS (
        SELECT get_local_date(created_at) AS d, COUNT(*)::INTEGER AS cnt
        FROM public.comment_likes
        WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date
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

DROP FUNCTION IF EXISTS get_revenue_trend(INTEGER, VARCHAR);
CREATE OR REPLACE FUNCTION get_revenue_trend(
    p_days INTEGER DEFAULT 30,
    p_site VARCHAR DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    stat_date DATE,
    points_in BIGINT,
    points_out BIGINT,
    redemptions INTEGER
) AS $$
DECLARE
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
    v_start_date DATE := COALESCE(p_start_date, v_end_date - GREATEST(COALESCE(p_days, 30) - 1, 0));
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    WITH date_series AS (
        SELECT generate_series(v_start_date, v_end_date, INTERVAL '1 day')::date AS d
    ),
    ledger_by_day AS (
        SELECT
            get_local_date(created_at) AS d,
            COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0)::BIGINT AS in_amt,
            COALESCE(ABS(SUM(amount) FILTER (WHERE amount < 0)), 0)::BIGINT AS out_amt
        FROM public.points_ledger
        WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date
          AND (p_site IS NULL OR site = p_site)
        GROUP BY 1
    ),
    redemptions_by_day AS (
        SELECT get_local_date(used_at) AS d, COUNT(*)::INTEGER AS cnt
        FROM public.redemption_codes
        WHERE used_at IS NOT NULL
          AND get_local_date(used_at) BETWEEN v_start_date AND v_end_date
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

DROP FUNCTION IF EXISTS get_content_top(INTEGER, VARCHAR, INTEGER);
CREATE OR REPLACE FUNCTION get_content_top(
    p_limit INTEGER DEFAULT 10,
    p_site VARCHAR DEFAULT NULL,
    p_days INTEGER DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
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
        WHEN p_start_date IS NOT NULL THEN p_start_date
        WHEN p_days IS NOT NULL AND p_days > 0
            THEN COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date) - GREATEST(p_days - 1, 0)
        ELSE NULL
    END;
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
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
        AND (v_start_date IS NULL OR get_local_date(u.unlocked_at) BETWEEN v_start_date AND v_end_date)
    LEFT JOIN public.prompt_comments c ON c.prompt_id = p.id
        AND (p_site IS NULL OR c.site = p_site)
        AND (v_start_date IS NULL OR get_local_date(c.created_at) BETWEEN v_start_date AND v_end_date)
    GROUP BY p.id, p.title
    ORDER BY score DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_content_top_v2(INTEGER, VARCHAR, INTEGER);
DROP FUNCTION IF EXISTS get_content_top_v2(INTEGER, VARCHAR, INTEGER, DATE, DATE);
CREATE OR REPLACE FUNCTION get_content_top_v2(
    p_limit INTEGER DEFAULT 10,
    p_site VARCHAR DEFAULT NULL,
    p_days INTEGER DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    prompt_id TEXT,
    title TEXT,
    view_count BIGINT,
    unlock_count BIGINT,
    comment_count BIGINT,
    score NUMERIC,
    category TEXT
) AS $$
DECLARE
    v_start_date DATE := CASE
        WHEN p_start_date IS NOT NULL THEN p_start_date
        WHEN p_days IS NOT NULL AND p_days > 0
            THEN COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date) - GREATEST(p_days - 1, 0)
        ELSE NULL
    END;
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    WITH scoped_events AS (
        SELECT
            COALESCE(
                NULLIF(ue.event_data->>'entity_id', ''),
                NULLIF(ue.event_data->'metadata'->>'prompt_id', '')
            ) AS prompt_id,
            NULLIF(ue.event_data->'metadata'->>'title', '') AS prompt_title,
            NULLIF(ue.event_data->'metadata'->>'category', '') AS prompt_category,
            ue.event_name
        FROM public.user_events ue
        WHERE ue.user_id IS NOT NULL
          AND ue.event_name IN ('prompt_view', 'unlock_success')
          AND (v_start_date IS NULL OR get_local_date(ue.created_at) BETWEEN v_start_date AND v_end_date)
          AND (
              p_site IS NULL
              OR COALESCE(NULLIF(ue.site, ''), NULLIF(ue.event_data->>'site', ''), 'cn') = p_site
          )
    ),
    prompt_event_rollup AS (
        SELECT
            se.prompt_id,
            MAX(se.prompt_title) FILTER (WHERE se.prompt_title IS NOT NULL) AS title,
            MAX(se.prompt_category) FILTER (WHERE se.prompt_category IS NOT NULL) AS category,
            COUNT(*) FILTER (WHERE se.event_name = 'prompt_view') AS view_count,
            COUNT(*) FILTER (WHERE se.event_name = 'unlock_success') AS unlock_count
        FROM scoped_events se
        WHERE COALESCE(se.prompt_id, '') <> ''
        GROUP BY se.prompt_id
    ),
    prompt_comment_rollup AS (
        SELECT c.prompt_id::TEXT AS prompt_id, COUNT(*) AS comment_count
        FROM public.prompt_comments c
        WHERE (p_site IS NULL OR c.site = p_site)
          AND (v_start_date IS NULL OR get_local_date(c.created_at) BETWEEN v_start_date AND v_end_date)
        GROUP BY c.prompt_id::TEXT
    ),
    prompt_keys AS (
        SELECT prompt_id FROM prompt_event_rollup
        UNION
        SELECT prompt_id FROM prompt_comment_rollup
    )
    SELECT
        pk.prompt_id,
        COALESCE(NULLIF(per.title, ''), p.title, '未命名 Prompt')::TEXT AS title,
        COALESCE(per.view_count, 0)::BIGINT AS view_count,
        COALESCE(per.unlock_count, 0)::BIGINT AS unlock_count,
        COALESCE(pcr.comment_count, 0)::BIGINT AS comment_count,
        ROUND(
            COALESCE(per.unlock_count, 0)::NUMERIC * 3
            + COALESCE(pcr.comment_count, 0)::NUMERIC
            + COALESCE(per.view_count, 0)::NUMERIC * 0.2,
            2
        ) AS score,
        COALESCE(NULLIF(per.category, ''), '未分类')::TEXT AS category
    FROM prompt_keys pk
    LEFT JOIN prompt_event_rollup per ON per.prompt_id = pk.prompt_id
    LEFT JOIN prompt_comment_rollup pcr ON pcr.prompt_id = pk.prompt_id
    LEFT JOIN public.prompts p ON p.id::TEXT = pk.prompt_id
    WHERE COALESCE(pk.prompt_id, '') <> ''
    ORDER BY score DESC, unlock_count DESC, view_count DESC, comment_count DESC
    LIMIT GREATEST(COALESCE(p_limit, 10), 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_community_stats(INTEGER, VARCHAR);
CREATE OR REPLACE FUNCTION get_community_stats(
    p_days INTEGER DEFAULT 30,
    p_site VARCHAR DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    stat_date DATE,
    messages INTEGER,
    comments INTEGER,
    likes INTEGER
) AS $$
DECLARE
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
    v_start_date DATE := COALESCE(p_start_date, v_end_date - GREATEST(COALESCE(p_days, 30) - 1, 0));
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    WITH date_series AS (
        SELECT generate_series(v_start_date, v_end_date, INTERVAL '1 day')::date AS d
    ),
    messages_by_day AS (
        SELECT get_local_date(created_at) AS d, COUNT(*)::INTEGER AS cnt
        FROM public.guestbook_messages
        WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date
          AND (p_site IS NULL OR site = p_site)
        GROUP BY 1
    ),
    comments_by_day AS (
        SELECT get_local_date(created_at) AS d, COUNT(*)::INTEGER AS cnt
        FROM public.guestbook_comments
        WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date
          AND (p_site IS NULL OR site = p_site)
        GROUP BY 1
    ),
    likes_by_day AS (
        SELECT get_local_date(created_at) AS d, COUNT(*)::INTEGER AS cnt
        FROM public.guestbook_likes
        WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date
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

DROP FUNCTION IF EXISTS get_activity_heatmap(INTEGER, VARCHAR);
CREATE OR REPLACE FUNCTION get_activity_heatmap(
    p_days INTEGER DEFAULT 30,
    p_site VARCHAR DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    day_of_week INTEGER,
    hour_of_day INTEGER,
    activity_count BIGINT
) AS $$
DECLARE
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
    v_start_date DATE := COALESCE(p_start_date, v_end_date - GREATEST(COALESCE(p_days, 30) - 1, 0));
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    SELECT
        EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Shanghai')::INTEGER AS day_of_week,
        EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Shanghai')::INTEGER AS hour_of_day,
        COUNT(*) AS activity_count
    FROM public.user_login_history
    WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date
      AND (p_site IS NULL OR site = p_site)
    GROUP BY 1, 2
    ORDER BY 1, 2;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_conversion_funnel(INTEGER, VARCHAR);
CREATE OR REPLACE FUNCTION get_conversion_funnel(
    p_days INTEGER DEFAULT 30,
    p_site VARCHAR DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    step_name TEXT,
    step_order INTEGER,
    user_count BIGINT,
    conversion_rate NUMERIC,
    is_proxy_metric BOOLEAN
) AS $$
DECLARE
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
    v_start_date DATE := COALESCE(p_start_date, v_end_date - GREATEST(COALESCE(p_days, 30) - 1, 0));
    v_total_visitors BIGINT;
    v_prompt_viewers BIGINT;
    v_unlockers BIGINT;
BEGIN
    PERFORM public.require_admin_access();

    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT user_id) INTO v_total_visitors
        FROM public.user_login_history
        WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_total_visitors
        FROM public.user_login_history
        WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date AND site = p_site;
    END IF;

    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT user_id) INTO v_prompt_viewers
        FROM (
            SELECT user_id FROM public.prompt_comments WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date
            UNION
            SELECT user_id FROM public.prompt_unlocks WHERE get_local_date(unlocked_at) BETWEEN v_start_date AND v_end_date
        ) viewers;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_prompt_viewers
        FROM (
            SELECT user_id FROM public.prompt_comments WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date AND site = p_site
            UNION
            SELECT user_id FROM public.prompt_unlocks WHERE get_local_date(unlocked_at) BETWEEN v_start_date AND v_end_date AND site = p_site
        ) viewers;
    END IF;

    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT user_id) INTO v_unlockers
        FROM public.prompt_unlocks
        WHERE get_local_date(unlocked_at) BETWEEN v_start_date AND v_end_date;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_unlockers
        FROM public.prompt_unlocks
        WHERE get_local_date(unlocked_at) BETWEEN v_start_date AND v_end_date AND site = p_site;
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

DROP FUNCTION IF EXISTS get_conversion_funnel_v2(INTEGER, VARCHAR);
CREATE OR REPLACE FUNCTION get_conversion_funnel_v2(
    p_days INTEGER DEFAULT 30,
    p_site VARCHAR DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    step_name TEXT,
    step_order INTEGER,
    user_count BIGINT,
    conversion_rate NUMERIC,
    is_proxy_metric BOOLEAN
) AS $$
DECLARE
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
    v_start_date DATE := COALESCE(p_start_date, v_end_date - GREATEST(COALESCE(p_days, 30) - 1, 0));
    v_prompt_view_users BIGINT := 0;
    v_unlock_click_users BIGINT := 0;
    v_unlock_success_users BIGINT := 0;
BEGIN
    PERFORM public.require_admin_access();

    WITH scoped_events AS (
        SELECT ue.user_id, ue.event_name
        FROM public.user_events ue
        WHERE ue.user_id IS NOT NULL
          AND get_local_date(ue.created_at) BETWEEN v_start_date AND v_end_date
          AND ue.event_name IN ('prompt_view', 'unlock_click', 'unlock_success')
          AND (
              p_site IS NULL
              OR COALESCE(NULLIF(ue.site, ''), NULLIF(ue.event_data->>'site', ''), 'cn') = p_site
          )
    )
    SELECT
        COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'prompt_view'),
        COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'unlock_click'),
        COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'unlock_success')
    INTO
        v_prompt_view_users,
        v_unlock_click_users,
        v_unlock_success_users
    FROM scoped_events;

    RETURN QUERY
    SELECT 'Prompt 浏览'::TEXT, 1, COALESCE(v_prompt_view_users, 0), 100.0::NUMERIC, FALSE
    UNION ALL
    SELECT '解锁点击'::TEXT, 2, COALESCE(v_unlock_click_users, 0),
        ROUND(safe_divide(COALESCE(v_unlock_click_users, 0)::NUMERIC, NULLIF(v_prompt_view_users, 0)::NUMERIC) * 100, 1),
        FALSE
    UNION ALL
    SELECT '内容解锁'::TEXT, 3, COALESCE(v_unlock_success_users, 0),
        ROUND(safe_divide(COALESCE(v_unlock_success_users, 0)::NUMERIC, NULLIF(v_prompt_view_users, 0)::NUMERIC) * 100, 1),
        FALSE
    ORDER BY 2;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_points_flow(INTEGER, VARCHAR);
CREATE OR REPLACE FUNCTION get_points_flow(
    p_days INTEGER DEFAULT 30,
    p_site VARCHAR DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    source_node TEXT,
    target_node TEXT,
    value NUMERIC
) AS $$
DECLARE
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
    v_start_date DATE := COALESCE(p_start_date, v_end_date - GREATEST(COALESCE(p_days, 30) - 1, 0));
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
    WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date AND amount > 0
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
    WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date AND amount < 0
      AND (p_site IS NULL OR site = p_site)
    GROUP BY 2
    ORDER BY value DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_points_flow_v2(INTEGER, VARCHAR);
CREATE OR REPLACE FUNCTION get_points_flow_v2(
    p_days INTEGER DEFAULT 30,
    p_site VARCHAR DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    source_node TEXT,
    target_node TEXT,
    value NUMERIC
) AS $$
DECLARE
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
    v_start_date DATE := COALESCE(p_start_date, v_end_date - GREATEST(COALESCE(p_days, 30) - 1, 0));
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    WITH ledger_classified AS (
        SELECT
            CASE
                WHEN pl.amount > 0 THEN
                    CASE
                        WHEN pl.reason = 'redeem_code' OR pl.reason ILIKE '%兑换码%' OR pl.reason ILIKE '%redeem%' THEN '兑换码'
                        WHEN pl.reason ILIKE '推广返佣%' OR UPPER(COALESCE(pl.reference_id, '')) LIKE 'AFFILIATE_REWARD_%' OR UPPER(COALESCE(pl.reference_id, '')) LIKE 'AFF_REW_%' THEN '推广返佣'
                        WHEN UPPER(COALESCE(pl.reference_id, '')) LIKE 'REG_REWARD_UNLOCK_%' OR pl.reason ILIKE '%首单激活%' OR pl.reason ILIKE '%首充激活%' THEN '拉新激活'
                        WHEN UPPER(COALESCE(pl.reference_id, '')) LIKE 'REG_REWARD_%' OR pl.reason ILIKE '邀请拉新奖励%' OR pl.reason IN ('signup_bonus', 'register_bonus') THEN '注册奖励'
                        WHEN pl.reason = 'daily_checkin' THEN '签到奖励'
                        WHEN pl.reason IN ('package_purchase', 'afdian_recharge', 'custom_recharge') OR pl.reason ILIKE '模拟充值:%' OR pl.reason ILIKE '模拟充值：%' OR pl.reason ILIKE '%充值%' OR pl.reason ILIKE '%recharge%' THEN '充值'
                        ELSE '其他收入'
                    END
                ELSE '用户余额'
            END::TEXT AS source_node,
            CASE
                WHEN pl.amount > 0 THEN '用户余额'
                ELSE
                    CASE
                        WHEN pl.reason = 'unlock_prompt' OR pl.reason ILIKE '%unlock%' OR pl.reason ILIKE '%解锁%' THEN '内容解锁'
                        WHEN (LOWER(COALESCE(pl.reason, '')) LIKE '%google one%' AND (
                            LOWER(COALESCE(pl.reason, '')) LIKE '%链接获取服务%'
                            OR LOWER(COALESCE(pl.reason, '')) LIKE '%trial link%'
                            OR LOWER(COALESCE(pl.reason, '')) LIKE '%link service%'
                            OR LOWER(COALESCE(pl.reason, '')) LIKE '%verify service%'
                        )) THEN '验证服务'
                        WHEN pl.reason ILIKE '商城购买:%' OR pl.reason ILIKE 'shop purchase:%' OR UPPER(COALESCE(pl.reference_id, '')) LIKE 'SHOP_ORDER_%' THEN '商城兑换'
                        WHEN pl.reason = 'makeup_checkin_cost' THEN '补签成本'
                        WHEN pl.reason ILIKE '%deduct%' OR pl.reason ILIKE 'admin_manual:%' OR pl.reason ILIKE '%admin%' OR pl.reason ILIKE '%扣除%' THEN '管理扣除'
                        ELSE '其他消费'
                    END
            END::TEXT AS target_node,
            ABS(pl.amount)::NUMERIC AS value
        FROM public.points_ledger pl
        WHERE get_local_date(pl.created_at) BETWEEN v_start_date AND v_end_date
          AND (p_site IS NULL OR pl.site = p_site)
    ),
    ledger_agg AS (
        SELECT lc.source_node, lc.target_node, ROUND(SUM(lc.value), 1)::NUMERIC AS value
        FROM ledger_classified lc
        GROUP BY lc.source_node, lc.target_node
    ),
    event_agg AS (
        SELECT
            CASE
                WHEN points_delta > 0 AND event_name = 'recharge_success' THEN '充值'
                WHEN points_delta > 0 AND event_name = 'checkin_success' THEN '签到奖励'
                WHEN points_delta < 0 THEN '用户余额'
                ELSE NULL
            END::TEXT AS source_node,
            CASE
                WHEN points_delta > 0 THEN '用户余额'
                WHEN points_delta < 0 AND event_name = 'unlock_success' THEN '内容解锁'
                WHEN points_delta < 0 AND event_name = 'verify_submit' THEN '验证服务'
                WHEN points_delta < 0 AND event_name = 'shop_purchase' THEN '商城兑换'
                ELSE NULL
            END::TEXT AS target_node,
            ROUND(SUM(ABS(points_delta)), 1)::NUMERIC AS value
        FROM (
            SELECT
                ue.event_name,
                COALESCE(
                    NULLIF(ue.event_data->>'points_delta', '')::NUMERIC,
                    NULLIF(ue.event_data->'metadata'->>'points_amount', '')::NUMERIC,
                    NULLIF(ue.event_data->'metadata'->>'points_cost', '')::NUMERIC * CASE
                        WHEN ue.event_name = 'verify_submit' THEN -1 ELSE 1
                    END,
                    0
                ) AS points_delta
            FROM public.user_events ue
            WHERE ue.user_id IS NOT NULL
              AND ue.event_name IN ('recharge_success', 'checkin_success', 'unlock_success', 'verify_submit', 'shop_purchase')
              AND get_local_date(ue.created_at) BETWEEN v_start_date AND v_end_date
              AND (
                  p_site IS NULL
                  OR COALESCE(NULLIF(ue.site, ''), NULLIF(ue.event_data->>'site', ''), 'cn') = p_site
              )
        ) scoped_events
        WHERE points_delta <> 0
        GROUP BY 1, 2
    ),
    combined_pairs AS (
        SELECT source_node, target_node FROM ledger_agg
        UNION
        SELECT source_node, target_node FROM event_agg
    )
    SELECT
        cp.source_node,
        cp.target_node,
        CASE
            WHEN (cp.source_node, cp.target_node) IN (
                ('充值', '用户余额'),
                ('签到奖励', '用户余额'),
                ('用户余额', '内容解锁'),
                ('用户余额', '验证服务'),
                ('用户余额', '商城兑换')
            ) THEN ROUND(GREATEST(COALESCE(ea.value, 0), COALESCE(la.value, 0)), 1)::NUMERIC
            ELSE ROUND(COALESCE(la.value, 0), 1)::NUMERIC
        END AS value
    FROM combined_pairs cp
    LEFT JOIN ledger_agg la ON la.source_node = cp.source_node AND la.target_node = cp.target_node
    LEFT JOIN event_agg ea ON ea.source_node = cp.source_node AND ea.target_node = cp.target_node
    WHERE CASE
        WHEN (cp.source_node, cp.target_node) IN (
            ('充值', '用户余额'),
            ('签到奖励', '用户余额'),
            ('用户余额', '内容解锁'),
            ('用户余额', '验证服务'),
            ('用户余额', '商城兑换')
        ) THEN GREATEST(COALESCE(ea.value, 0), COALESCE(la.value, 0))
        ELSE COALESCE(la.value, 0)
    END > 0
    ORDER BY value DESC, source_node, target_node;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_redemption_funnel(VARCHAR, INTEGER);
CREATE OR REPLACE FUNCTION get_redemption_funnel(
    p_site VARCHAR DEFAULT NULL,
    p_days INTEGER DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
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
        WHEN p_start_date IS NOT NULL THEN p_start_date
        WHEN p_days IS NOT NULL AND p_days > 0
            THEN COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date) - GREATEST(p_days - 1, 0)
        ELSE NULL
    END;
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
BEGIN
    PERFORM public.require_admin_access();

    IF p_site IS NULL THEN
        SELECT COUNT(*) INTO v_generated
        FROM public.redemption_codes
        WHERE v_start_date IS NULL OR get_local_date(created_at) BETWEEN v_start_date AND v_end_date;
    ELSE
        SELECT COUNT(*) INTO v_generated
        FROM public.redemption_codes
        WHERE site = p_site
          AND (v_start_date IS NULL OR get_local_date(created_at) BETWEEN v_start_date AND v_end_date);
    END IF;

    IF p_site IS NULL THEN
        SELECT COUNT(*) INTO v_redeemed
        FROM public.redemption_codes
        WHERE status = 'used'
          AND (v_start_date IS NULL OR get_local_date(created_at) BETWEEN v_start_date AND v_end_date);
    ELSE
        SELECT COUNT(*) INTO v_redeemed
        FROM public.redemption_codes
        WHERE status = 'used'
          AND site = p_site
          AND (v_start_date IS NULL OR get_local_date(created_at) BETWEEN v_start_date AND v_end_date);
    END IF;

    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT used_by) INTO v_users
        FROM public.redemption_codes
        WHERE status = 'used'
          AND used_by IS NOT NULL
          AND (v_start_date IS NULL OR get_local_date(created_at) BETWEEN v_start_date AND v_end_date);
    ELSE
        SELECT COUNT(DISTINCT used_by) INTO v_users
        FROM public.redemption_codes
        WHERE status = 'used'
          AND used_by IS NOT NULL
          AND site = p_site
          AND (v_start_date IS NULL OR get_local_date(created_at) BETWEEN v_start_date AND v_end_date);
    END IF;

    RETURN QUERY SELECT '已生成', v_generated, 100.0::NUMERIC;
    RETURN QUERY SELECT '已核销', v_redeemed,
        CASE WHEN v_generated > 0 THEN ROUND((v_redeemed::NUMERIC / v_generated::NUMERIC) * 100, 2) ELSE 0 END;
    RETURN QUERY SELECT '核销人数', v_users,
        CASE WHEN v_redeemed > 0 THEN ROUND((v_users::NUMERIC / v_redeemed::NUMERIC) * 100, 2) ELSE 0 END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_channel_breakdown(VARCHAR, INTEGER);
CREATE OR REPLACE FUNCTION get_channel_breakdown(
    p_site VARCHAR DEFAULT NULL,
    p_days INTEGER DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
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
        WHEN p_start_date IS NOT NULL THEN p_start_date
        WHEN p_days IS NOT NULL AND p_days > 0
            THEN COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date) - GREATEST(p_days - 1, 0)
        ELSE NULL
    END;
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
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
        AND (v_start_date IS NULL OR get_local_date(c.created_at) BETWEEN v_start_date AND v_end_date)
    LEFT JOIN public.points_packages pkg ON b.package_id = pkg.id
    GROUP BY COALESCE(b.channel, '未分类')
    ORDER BY total_points DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_channel_breakdown_v2(VARCHAR, INTEGER);
CREATE OR REPLACE FUNCTION get_channel_breakdown_v2(
    p_site VARCHAR DEFAULT NULL,
    p_days INTEGER DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    channel TEXT,
    event_count BIGINT,
    user_count BIGINT,
    unlock_success_count BIGINT,
    verify_submit_count BIGINT,
    recharge_success_count BIGINT,
    shop_purchase_count BIGINT,
    share_rate NUMERIC,
    source_kind TEXT
) AS $$
DECLARE
    v_start_date DATE := CASE
        WHEN p_start_date IS NOT NULL THEN p_start_date
        WHEN p_days IS NOT NULL AND p_days > 0
            THEN COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date) - GREATEST(p_days - 1, 0)
        ELSE NULL
    END;
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    WITH scoped_events AS (
        SELECT
            ue.user_id,
            ue.event_name,
            LOWER(COALESCE(NULLIF(ue.event_data->'metadata'->>'entry', ''), '')) AS entry_key,
            LOWER(COALESCE(NULLIF(ue.event_data->'metadata'->>'source_module', ''), '')) AS source_module_key,
            LOWER(COALESCE(NULLIF(ue.event_data->'metadata'->>'channel', ''), '')) AS action_channel_key,
            LOWER(COALESCE(NULLIF(ue.event_data->>'page', ''), NULLIF(ue.page_url, ''), '')) AS page_key
        FROM public.user_events ue
        WHERE ue.user_id IS NOT NULL
          AND ue.event_name IN (
              'prompt_view',
              'unlock_success',
              'wallet_open',
              'recharge_click',
              'recharge_success',
              'verify_submit',
              'shop_view',
              'shop_purchase',
              'guestbook_post',
              'affiliate_invite_click'
          )
          AND (v_start_date IS NULL OR get_local_date(ue.created_at) BETWEEN v_start_date AND v_end_date)
          AND (
              p_site IS NULL
              OR COALESCE(NULLIF(ue.site, ''), NULLIF(ue.event_data->>'site', ''), 'cn') = p_site
          )
    ),
    labeled_events AS (
        SELECT
            CASE
                WHEN se.entry_key = 'unlock_insufficient_points' THEN '内容解锁补款'
                WHEN se.entry_key = 'shop_insufficient_points' THEN '商城积分不足'
                WHEN se.entry_key = 'verify_balance' THEN '验证服务入口'
                WHEN se.entry_key = 'nav_wallet' THEN '导航钱包'
                WHEN se.entry_key = 'nav_orders' THEN '导航订单'
                WHEN se.entry_key = 'homepage_guestbook' THEN '首页留言板'
                WHEN se.entry_key = 'guestbook_page' THEN '留言板页面'
                WHEN se.entry_key = 'wallet_balance' THEN '钱包余额页'
                WHEN se.entry_key = 'wallet_recharge' THEN '钱包充值页'
                WHEN se.action_channel_key = 'copy_link' THEN '推广链接分享'
                WHEN se.action_channel_key = 'poster_download' THEN '推广海报下载'
                WHEN se.source_module_key = 'prompt_gallery' THEN 'Prompt 内容页'
                WHEN se.source_module_key = 'verify_widget' THEN '验证服务'
                WHEN se.source_module_key = 'shop_client' THEN '商城'
                WHEN se.source_module_key = 'auth_dropdown' THEN '账户下拉'
                WHEN se.source_module_key = 'wallet_modal' THEN '钱包弹窗'
                WHEN se.page_key IN ('/', '/index.html') THEN '首页'
                WHEN se.page_key LIKE '%/shop.html%' THEN '商城页'
                WHEN se.page_key LIKE '%/verify.html%' THEN '验证页'
                WHEN se.page_key LIKE '%/guestbook.html%' THEN '留言板页'
                ELSE '其他来源'
            END::TEXT AS channel,
            se.user_id,
            se.event_name
        FROM scoped_events se
    ),
    rollup AS (
        SELECT
            le.channel,
            COUNT(*) AS event_count,
            COUNT(DISTINCT le.user_id) AS user_count,
            COUNT(*) FILTER (WHERE le.event_name = 'unlock_success') AS unlock_success_count,
            COUNT(*) FILTER (WHERE le.event_name = 'verify_submit') AS verify_submit_count,
            COUNT(*) FILTER (WHERE le.event_name = 'recharge_success') AS recharge_success_count,
            COUNT(*) FILTER (WHERE le.event_name = 'shop_purchase') AS shop_purchase_count
        FROM labeled_events le
        GROUP BY le.channel
    ),
    totals AS (
        SELECT SUM(r.event_count) AS total_events FROM rollup r
    )
    SELECT
        r.channel,
        r.event_count,
        r.user_count,
        r.unlock_success_count,
        r.verify_submit_count,
        r.recharge_success_count,
        r.shop_purchase_count,
        ROUND(safe_divide(COALESCE(r.event_count, 0)::NUMERIC, NULLIF(t.total_events, 0)::NUMERIC) * 100, 2) AS share_rate,
        '业务入口'::TEXT AS source_kind
    FROM rollup r
    CROSS JOIN totals t
    ORDER BY r.event_count DESC, r.user_count DESC, r.channel ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_ai_summary_data(INTEGER, VARCHAR);
CREATE OR REPLACE FUNCTION get_ai_summary_data(
    p_days INTEGER DEFAULT 7,
    p_site VARCHAR DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
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
    FROM (SELECT * FROM get_user_trend(p_days, p_site, p_start_date, p_end_date)) t;

    SELECT jsonb_agg(t) INTO v_channel_breakdown
    FROM (SELECT * FROM get_channel_breakdown_v2(p_site, p_days, p_start_date, p_end_date)) t;

    SELECT jsonb_agg(t) INTO v_top_content
    FROM (SELECT * FROM get_content_top_v2(5, p_site, p_days, p_start_date, p_end_date)) t;

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

DROP FUNCTION IF EXISTS get_ai_summary_data_v2(INTEGER, VARCHAR);
CREATE OR REPLACE FUNCTION get_ai_summary_data_v2(
    p_days INTEGER DEFAULT 7,
    p_site VARCHAR DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
    v_start_date DATE := COALESCE(p_start_date, v_end_date - GREATEST(COALESCE(p_days, 7) - 1, 0));
    v_overview JSONB;
    v_user_trend JSONB;
    v_channel_breakdown JSONB;
    v_top_content JSONB;
    v_content_funnel JSONB;
    v_event_overview JSONB;
    v_event_funnels JSONB;
BEGIN
    PERFORM public.require_admin_access();

    SELECT get_overview_stats(p_site) INTO v_overview;

    SELECT jsonb_agg(t) INTO v_user_trend
    FROM (SELECT * FROM get_user_trend(p_days, p_site, p_start_date, p_end_date)) t;

    SELECT jsonb_agg(t) INTO v_channel_breakdown
    FROM (SELECT * FROM get_channel_breakdown_v2(p_site, p_days, p_start_date, p_end_date)) t;

    SELECT jsonb_agg(t) INTO v_top_content
    FROM (SELECT * FROM get_content_top_v2(5, p_site, p_days, p_start_date, p_end_date)) t;

    SELECT jsonb_agg(t) INTO v_content_funnel
    FROM (SELECT * FROM get_conversion_funnel_v2(p_days, p_site, p_start_date, p_end_date)) t;

    WITH scoped_events AS (
        SELECT ue.user_id, ue.event_name
        FROM public.user_events ue
        WHERE ue.user_id IS NOT NULL
          AND get_local_date(ue.created_at) BETWEEN v_start_date AND v_end_date
          AND (
              p_site IS NULL
              OR COALESCE(NULLIF(ue.site, ''), NULLIF(ue.event_data->>'site', ''), 'cn') = p_site
          )
          AND ue.event_name IN (
              'page_view',
              'prompt_view',
              'unlock_click',
              'unlock_success',
              'wallet_open',
              'recharge_click',
              'recharge_success',
              'verify_submit',
              'verify_success',
              'verify_fail',
              'shop_view',
              'shop_purchase',
              'guestbook_post',
              'affiliate_invite_click',
              'checkin_success'
          )
    ),
    event_rollup AS (
        SELECT
            COUNT(DISTINCT user_id) AS business_active_users,
            COUNT(*) FILTER (WHERE event_name = 'page_view') AS page_view_count,
            COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'page_view') AS page_view_users,
            COUNT(*) FILTER (WHERE event_name = 'prompt_view') AS prompt_view_count,
            COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'prompt_view') AS prompt_view_users,
            COUNT(*) FILTER (WHERE event_name = 'unlock_click') AS unlock_click_count,
            COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'unlock_click') AS unlock_click_users,
            COUNT(*) FILTER (WHERE event_name = 'unlock_success') AS unlock_success_count,
            COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'unlock_success') AS unlock_success_users,
            COUNT(*) FILTER (WHERE event_name = 'wallet_open') AS wallet_open_count,
            COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'wallet_open') AS wallet_open_users,
            COUNT(*) FILTER (WHERE event_name = 'recharge_click') AS recharge_click_count,
            COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'recharge_click') AS recharge_click_users,
            COUNT(*) FILTER (WHERE event_name = 'recharge_success') AS recharge_success_count,
            COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'recharge_success') AS recharge_success_users,
            COUNT(*) FILTER (WHERE event_name = 'verify_submit') AS verify_submit_count,
            COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'verify_submit') AS verify_submit_users,
            COUNT(*) FILTER (WHERE event_name = 'verify_success') AS verify_success_count,
            COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'verify_success') AS verify_success_users,
            COUNT(*) FILTER (WHERE event_name = 'verify_fail') AS verify_fail_count,
            COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'verify_fail') AS verify_fail_users,
            COUNT(*) FILTER (WHERE event_name = 'shop_view') AS shop_view_count,
            COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'shop_view') AS shop_view_users,
            COUNT(*) FILTER (WHERE event_name = 'shop_purchase') AS shop_purchase_count,
            COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'shop_purchase') AS shop_purchase_users,
            COUNT(*) FILTER (WHERE event_name = 'guestbook_post') AS guestbook_post_count,
            COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'guestbook_post') AS guestbook_post_users,
            COUNT(*) FILTER (WHERE event_name = 'affiliate_invite_click') AS affiliate_invite_click_count,
            COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'affiliate_invite_click') AS affiliate_invite_click_users,
            COUNT(*) FILTER (WHERE event_name = 'checkin_success') AS checkin_success_count,
            COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'checkin_success') AS checkin_success_users
        FROM scoped_events
    )
    SELECT
        jsonb_build_object(
            'business_active_users', COALESCE(business_active_users, 0),
            'page_view_count', COALESCE(page_view_count, 0),
            'page_view_users', COALESCE(page_view_users, 0),
            'prompt_view_count', COALESCE(prompt_view_count, 0),
            'prompt_view_users', COALESCE(prompt_view_users, 0),
            'unlock_click_count', COALESCE(unlock_click_count, 0),
            'unlock_click_users', COALESCE(unlock_click_users, 0),
            'unlock_success_count', COALESCE(unlock_success_count, 0),
            'unlock_success_users', COALESCE(unlock_success_users, 0),
            'unlock_rate', ROUND(safe_divide(COALESCE(unlock_success_users, 0)::NUMERIC, NULLIF(prompt_view_users, 0)::NUMERIC) * 100, 2),
            'wallet_open_count', COALESCE(wallet_open_count, 0),
            'wallet_open_users', COALESCE(wallet_open_users, 0),
            'recharge_click_count', COALESCE(recharge_click_count, 0),
            'recharge_click_users', COALESCE(recharge_click_users, 0),
            'recharge_success_count', COALESCE(recharge_success_count, 0),
            'recharge_success_users', COALESCE(recharge_success_users, 0),
            'recharge_success_rate', ROUND(safe_divide(COALESCE(recharge_success_users, 0)::NUMERIC, NULLIF(recharge_click_users, 0)::NUMERIC) * 100, 2),
            'verify_submit_count', COALESCE(verify_submit_count, 0),
            'verify_submit_users', COALESCE(verify_submit_users, 0),
            'verify_success_count', COALESCE(verify_success_count, 0),
            'verify_success_users', COALESCE(verify_success_users, 0),
            'verify_fail_count', COALESCE(verify_fail_count, 0),
            'verify_fail_users', COALESCE(verify_fail_users, 0),
            'verify_success_rate', ROUND(safe_divide(COALESCE(verify_success_count, 0)::NUMERIC, NULLIF(verify_submit_count, 0)::NUMERIC) * 100, 2),
            'shop_view_count', COALESCE(shop_view_count, 0),
            'shop_view_users', COALESCE(shop_view_users, 0),
            'shop_purchase_count', COALESCE(shop_purchase_count, 0),
            'shop_purchase_users', COALESCE(shop_purchase_users, 0),
            'shop_purchase_rate', ROUND(safe_divide(COALESCE(shop_purchase_users, 0)::NUMERIC, NULLIF(shop_view_users, 0)::NUMERIC) * 100, 2),
            'guestbook_post_count', COALESCE(guestbook_post_count, 0),
            'guestbook_post_users', COALESCE(guestbook_post_users, 0),
            'affiliate_invite_click_count', COALESCE(affiliate_invite_click_count, 0),
            'affiliate_invite_click_users', COALESCE(affiliate_invite_click_users, 0),
            'checkin_success_count', COALESCE(checkin_success_count, 0),
            'checkin_success_users', COALESCE(checkin_success_users, 0)
        ),
        jsonb_build_object(
            'content', COALESCE(v_content_funnel, '[]'::JSONB),
            'verify', jsonb_build_object(
                'submit_count', COALESCE(verify_submit_count, 0),
                'submit_users', COALESCE(verify_submit_users, 0),
                'success_count', COALESCE(verify_success_count, 0),
                'success_users', COALESCE(verify_success_users, 0),
                'fail_count', COALESCE(verify_fail_count, 0),
                'fail_users', COALESCE(verify_fail_users, 0),
                'success_rate', ROUND(safe_divide(COALESCE(verify_success_count, 0)::NUMERIC, NULLIF(verify_submit_count, 0)::NUMERIC) * 100, 2)
            ),
            'commerce', jsonb_build_object(
                'wallet_open_count', COALESCE(wallet_open_count, 0),
                'wallet_open_users', COALESCE(wallet_open_users, 0),
                'recharge_click_count', COALESCE(recharge_click_count, 0),
                'recharge_click_users', COALESCE(recharge_click_users, 0),
                'recharge_success_count', COALESCE(recharge_success_count, 0),
                'recharge_success_users', COALESCE(recharge_success_users, 0),
                'recharge_success_rate', ROUND(safe_divide(COALESCE(recharge_success_users, 0)::NUMERIC, NULLIF(recharge_click_users, 0)::NUMERIC) * 100, 2),
                'shop_view_count', COALESCE(shop_view_count, 0),
                'shop_view_users', COALESCE(shop_view_users, 0),
                'shop_purchase_count', COALESCE(shop_purchase_count, 0),
                'shop_purchase_users', COALESCE(shop_purchase_users, 0),
                'shop_purchase_rate', ROUND(safe_divide(COALESCE(shop_purchase_users, 0)::NUMERIC, NULLIF(shop_view_users, 0)::NUMERIC) * 100, 2)
            ),
            'growth', jsonb_build_object(
                'guestbook_post_count', COALESCE(guestbook_post_count, 0),
                'guestbook_post_users', COALESCE(guestbook_post_users, 0),
                'affiliate_invite_click_count', COALESCE(affiliate_invite_click_count, 0),
                'affiliate_invite_click_users', COALESCE(affiliate_invite_click_users, 0),
                'checkin_success_count', COALESCE(checkin_success_count, 0),
                'checkin_success_users', COALESCE(checkin_success_users, 0)
            )
        )
    INTO v_event_overview, v_event_funnels
    FROM event_rollup;

    RETURN jsonb_build_object(
        'period_days', p_days,
        'overview', v_overview,
        'user_trend', v_user_trend,
        'channel_breakdown', v_channel_breakdown,
        'top_content', v_top_content,
        'event_overview', COALESCE(v_event_overview, '{}'::JSONB),
        'event_funnels', COALESCE(v_event_funnels, '{}'::JSONB),
        'generated_at', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_user_trend(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_content_trend(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_revenue_trend(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_content_top(INTEGER, VARCHAR, INTEGER, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_content_top_v2(INTEGER, VARCHAR, INTEGER, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_community_stats(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_activity_heatmap(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_conversion_funnel(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_conversion_funnel_v2(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_points_flow(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_points_flow_v2(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_redemption_funnel(VARCHAR, INTEGER, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_channel_breakdown(VARCHAR, INTEGER, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_channel_breakdown_v2(VARCHAR, INTEGER, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ai_summary_data(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ai_summary_data_v2(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
