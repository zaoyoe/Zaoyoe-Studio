-- ============================================
-- 数据分析 RPC 函数 - 站点过滤支持
-- 为所有分析函数增加 p_site 参数
-- p_site = NULL 时返回所有站点数据
-- ============================================

CREATE OR REPLACE FUNCTION public.require_admin_access()
RETURNS VOID AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.require_admin_access() TO authenticated;

-- ============================================
-- 1. OVERVIEW STATS (带站点过滤)
-- ============================================

CREATE OR REPLACE FUNCTION get_overview_stats(p_site VARCHAR DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_dau INTEGER;
    v_mau INTEGER;
    v_login_dau INTEGER;
    v_login_mau INTEGER;
    v_business_dau INTEGER;
    v_business_mau INTEGER;
    v_new_users_today INTEGER;
    v_new_users_week INTEGER;
    v_global_new_users_today INTEGER;
    v_global_new_users_week INTEGER;
    v_site_attributed_new_users_today INTEGER;
    v_site_attributed_new_users_week INTEGER;
    v_selected_site_new_users_today INTEGER;
    v_selected_site_new_users_week INTEGER;
    v_unattributed_new_users_today INTEGER;
    v_unattributed_new_users_week INTEGER;
    v_total_points_circulation BIGINT;
    v_total_comments INTEGER;
    v_today DATE := (NOW() AT TIME ZONE 'Asia/Shanghai')::date;
    v_week_start DATE := v_today - 6;
    v_month_start DATE := v_today - 29;
BEGIN
    PERFORM public.require_admin_access();

    -- Login activity reference (legacy DAU / MAU semantics).
    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT user_id) INTO v_login_dau
        FROM public.user_login_history
        WHERE get_local_date(created_at) = v_today;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_login_dau
        FROM public.user_login_history
        WHERE get_local_date(created_at) = v_today AND site = p_site;
    END IF;

    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT user_id) INTO v_login_mau
        FROM public.user_login_history
        WHERE get_local_date(created_at) >= v_month_start;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_login_mau
        FROM public.user_login_history
        WHERE get_local_date(created_at) >= v_month_start AND site = p_site;
    END IF;

    -- Business activity: distinct users with effective business events.
    SELECT COUNT(DISTINCT ue.user_id)::INTEGER INTO v_business_dau
    FROM public.user_events ue
    WHERE ue.user_id IS NOT NULL
      AND get_local_date(ue.created_at) = v_today
      AND (
          p_site IS NULL
          OR COALESCE(NULLIF(ue.site, ''), NULLIF(ue.event_data->>'site', ''), 'cn') = p_site
      )
      AND ue.event_name IN (
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
      );

    SELECT COUNT(DISTINCT ue.user_id)::INTEGER INTO v_business_mau
    FROM public.user_events ue
    WHERE ue.user_id IS NOT NULL
      AND get_local_date(ue.created_at) >= v_month_start
      AND (
          p_site IS NULL
          OR COALESCE(NULLIF(ue.site, ''), NULLIF(ue.event_data->>'site', ''), 'cn') = p_site
      )
      AND ue.event_name IN (
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
      );

    v_dau := COALESCE(v_business_dau, 0);
    v_mau := COALESCE(v_business_mau, 0);

    -- New users: global registrations + site attribution based on first observed site activity.
    WITH scoped_new_users AS (
        SELECT
            u.id AS user_id,
            get_local_date(u.created_at) AS signup_date
        FROM auth.users u
        WHERE get_local_date(u.created_at) BETWEEN v_week_start AND v_today
    ),
    attributed_new_users AS (
        SELECT
            snu.user_id,
            snu.signup_date,
            first_touch.site_value AS attributed_site
        FROM scoped_new_users snu
        LEFT JOIN LATERAL (
            SELECT observed_site.site_value
            FROM (
                SELECT
                    ulh.created_at,
                    CASE
                        WHEN LOWER(BTRIM(COALESCE(ulh.site, ''))) IN ('cn', 'intl')
                            THEN LOWER(BTRIM(ulh.site))
                        ELSE NULL
                    END AS site_value
                FROM public.user_login_history ulh
                WHERE ulh.user_id = snu.user_id
                UNION ALL
                SELECT
                    ue.created_at,
                    CASE
                        WHEN LOWER(BTRIM(COALESCE(ue.site, ue.event_data->>'site', ''))) IN ('cn', 'intl')
                            THEN LOWER(BTRIM(COALESCE(ue.site, ue.event_data->>'site', '')))
                        ELSE NULL
                    END AS site_value
                FROM public.user_events ue
                WHERE ue.user_id = snu.user_id
            ) observed_site
            WHERE observed_site.site_value IS NOT NULL
            ORDER BY observed_site.created_at ASC, observed_site.site_value ASC
            LIMIT 1
        ) first_touch ON TRUE
    )
    SELECT
        COUNT(*) FILTER (WHERE signup_date = v_today)::INTEGER,
        COUNT(*)::INTEGER,
        COUNT(*) FILTER (WHERE signup_date = v_today AND attributed_site IS NOT NULL)::INTEGER,
        COUNT(*) FILTER (WHERE attributed_site IS NOT NULL)::INTEGER,
        COUNT(*) FILTER (WHERE signup_date = v_today AND attributed_site = p_site)::INTEGER,
        COUNT(*) FILTER (WHERE attributed_site = p_site)::INTEGER
    INTO
        v_global_new_users_today,
        v_global_new_users_week,
        v_site_attributed_new_users_today,
        v_site_attributed_new_users_week,
        v_selected_site_new_users_today,
        v_selected_site_new_users_week
    FROM attributed_new_users;

    v_unattributed_new_users_today := GREATEST(
        COALESCE(v_global_new_users_today, 0) - COALESCE(v_site_attributed_new_users_today, 0),
        0
    );
    v_unattributed_new_users_week := GREATEST(
        COALESCE(v_global_new_users_week, 0) - COALESCE(v_site_attributed_new_users_week, 0),
        0
    );

    IF p_site IS NULL THEN
        v_new_users_today := COALESCE(v_global_new_users_today, 0);
        v_new_users_week := COALESCE(v_global_new_users_week, 0);
    ELSE
        v_new_users_today := COALESCE(v_selected_site_new_users_today, 0);
        v_new_users_week := COALESCE(v_selected_site_new_users_week, 0);
    END IF;

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
        'business_dau', COALESCE(v_business_dau, 0),
        'business_mau', COALESCE(v_business_mau, 0),
        'login_dau', COALESCE(v_login_dau, 0),
        'login_mau', COALESCE(v_login_mau, 0),
        'active_users_scope', 'business_event',
        'login_users_scope', 'login_history',
        'active_users_model', 'effective_business_event',
        'new_users_today', COALESCE(v_new_users_today, 0),
        'new_users_week', COALESCE(v_new_users_week, 0),
        'global_new_users_today', COALESCE(v_global_new_users_today, 0),
        'global_new_users_week', COALESCE(v_global_new_users_week, 0),
        'site_attributed_new_users_today', COALESCE(
            CASE WHEN p_site IS NULL THEN v_site_attributed_new_users_today ELSE v_selected_site_new_users_today END,
            0
        ),
        'site_attributed_new_users_week', COALESCE(
            CASE WHEN p_site IS NULL THEN v_site_attributed_new_users_week ELSE v_selected_site_new_users_week END,
            0
        ),
        'unattributed_new_users_today', COALESCE(v_unattributed_new_users_today, 0),
        'unattributed_new_users_week', COALESCE(v_unattributed_new_users_week, 0),
        'new_users_scope', CASE
            WHEN p_site IS NULL THEN 'global_registration'
            ELSE 'site_first_touch'
        END,
        'site_attribution_model', 'first_site_activity',
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

DROP FUNCTION IF EXISTS get_user_trend(INTEGER, VARCHAR);
DROP FUNCTION IF EXISTS get_user_trend(INTEGER, VARCHAR, DATE, DATE);

CREATE OR REPLACE FUNCTION get_user_trend(
    p_days INTEGER DEFAULT 30,
    p_site VARCHAR DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    stat_date DATE,
    new_users INTEGER,
    active_users INTEGER,
    login_active_users INTEGER
) AS $$
DECLARE
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
    v_start_date DATE := COALESCE(p_start_date, v_end_date - GREATEST(COALESCE(p_days, 30) - 1, 0));
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    WITH date_series AS (
        SELECT generate_series(
            v_start_date,
            v_end_date,
            INTERVAL '1 day'
        )::date AS d
    ),
    scoped_new_users AS (
        SELECT
            u.id AS user_id,
            get_local_date(u.created_at) AS signup_date
        FROM auth.users u
        WHERE get_local_date(u.created_at) BETWEEN v_start_date AND v_end_date
    ),
    attributed_new_users AS (
        SELECT 
            snu.user_id,
            snu.signup_date AS d,
            first_touch.site_value AS attributed_site
        FROM scoped_new_users snu
        LEFT JOIN LATERAL (
            SELECT observed_site.site_value
            FROM (
                SELECT
                    ulh.created_at,
                    CASE
                        WHEN LOWER(BTRIM(COALESCE(ulh.site, ''))) IN ('cn', 'intl')
                            THEN LOWER(BTRIM(ulh.site))
                        ELSE NULL
                    END AS site_value
                FROM public.user_login_history ulh
                WHERE ulh.user_id = snu.user_id
                UNION ALL
                SELECT
                    ue.created_at,
                    CASE
                        WHEN LOWER(BTRIM(COALESCE(ue.site, ue.event_data->>'site', ''))) IN ('cn', 'intl')
                            THEN LOWER(BTRIM(COALESCE(ue.site, ue.event_data->>'site', '')))
                        ELSE NULL
                    END AS site_value
                FROM public.user_events ue
                WHERE ue.user_id = snu.user_id
            ) observed_site
            WHERE observed_site.site_value IS NOT NULL
            ORDER BY observed_site.created_at ASC, observed_site.site_value ASC
            LIMIT 1
        ) first_touch ON TRUE
    ),
    new_users_by_day AS (
        SELECT
            anu.d,
            COUNT(*)::INTEGER AS global_cnt,
            COUNT(*) FILTER (WHERE anu.attributed_site = p_site)::INTEGER AS site_cnt
        FROM attributed_new_users anu
        GROUP BY 1
    ),
    business_active_users_by_day AS (
        SELECT
            get_local_date(ue.created_at) AS d,
            COUNT(DISTINCT ue.user_id)::INTEGER AS cnt
        FROM public.user_events ue
        WHERE ue.user_id IS NOT NULL
          AND get_local_date(ue.created_at) BETWEEN v_start_date AND v_end_date
          AND (
              p_site IS NULL
              OR COALESCE(NULLIF(ue.site, ''), NULLIF(ue.event_data->>'site', ''), 'cn') = p_site
          )
          AND ue.event_name IN (
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
        GROUP BY 1
    ),
    login_active_users_by_day AS (
        SELECT 
            get_local_date(created_at) AS d,
            COUNT(DISTINCT user_id)::INTEGER AS cnt
        FROM public.user_login_history
        WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date
          AND (p_site IS NULL OR site = p_site)
        GROUP BY 1
    )
    SELECT 
        ds.d AS stat_date,
        COALESCE(CASE WHEN p_site IS NULL THEN nu.global_cnt ELSE nu.site_cnt END, 0) AS new_users,
        COALESCE(bau.cnt, 0) AS active_users,
        COALESCE(lau.cnt, 0) AS login_active_users
    FROM date_series ds
    LEFT JOIN new_users_by_day nu ON nu.d = ds.d
    LEFT JOIN business_active_users_by_day bau ON bau.d = ds.d
    LEFT JOIN login_active_users_by_day lau ON lau.d = ds.d
    ORDER BY ds.d ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old signature
DROP FUNCTION IF EXISTS get_user_trend(INTEGER);

-- ============================================
-- 3. CONTENT TREND (带站点过滤)
-- ============================================

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
        SELECT generate_series(
            v_start_date,
            v_end_date,
            INTERVAL '1 day'
        )::date AS d
    ),
    comments_by_day AS (
        SELECT 
            get_local_date(created_at) AS d,
            COUNT(*)::INTEGER AS cnt
        FROM public.prompt_comments
        WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date
          AND (p_site IS NULL OR site = p_site)
        GROUP BY 1
    ),
    unlocks_by_day AS (
        SELECT 
            get_local_date(unlocked_at) AS d,
            COUNT(*)::INTEGER AS cnt
        FROM public.prompt_unlocks
        WHERE get_local_date(unlocked_at) BETWEEN v_start_date AND v_end_date
          AND (p_site IS NULL OR site = p_site)
        GROUP BY 1
    ),
    likes_by_day AS (
        SELECT 
            get_local_date(created_at) AS d,
            COUNT(*)::INTEGER AS cnt
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

-- Drop old signature
DROP FUNCTION IF EXISTS get_content_trend(INTEGER);

-- ============================================
-- 4. REVENUE TREND (带站点过滤)
-- ============================================

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
        SELECT generate_series(
            v_start_date,
            v_end_date,
            INTERVAL '1 day'
        )::date AS d
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
        SELECT 
            get_local_date(used_at) AS d,
            COUNT(*)::INTEGER AS cnt
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

-- Drop old signature
DROP FUNCTION IF EXISTS get_revenue_trend(INTEGER);

-- ============================================
-- 5. CONTENT TOP N (带站点过滤)
-- ============================================

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
        WHEN p_start_date IS NOT NULL
            THEN p_start_date
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

-- Drop old signature
DROP FUNCTION IF EXISTS get_content_top(INTEGER);
DROP FUNCTION IF EXISTS get_content_top(INTEGER, VARCHAR);

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
        WHEN p_start_date IS NOT NULL
            THEN p_start_date
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
        SELECT
            c.prompt_id::TEXT AS prompt_id,
            COUNT(*) AS comment_count
        FROM public.prompt_comments c
        WHERE (p_site IS NULL OR c.site = p_site)
          AND (v_start_date IS NULL OR get_local_date(c.created_at) BETWEEN v_start_date AND v_end_date)
        GROUP BY c.prompt_id::TEXT
    ),
    prompt_keys AS (
        SELECT per.prompt_id AS prompt_id FROM prompt_event_rollup per
        UNION
        SELECT pcr.prompt_id AS prompt_id FROM prompt_comment_rollup pcr
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

-- ============================================
-- 6. COMMUNITY STATS (带站点过滤)
-- ============================================

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
        SELECT generate_series(
            v_start_date,
            v_end_date,
            INTERVAL '1 day'
        )::date AS d
    ),
    messages_by_day AS (
        SELECT 
            get_local_date(created_at) AS d,
            COUNT(*)::INTEGER AS cnt
        FROM public.guestbook_messages
        WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date
          AND (p_site IS NULL OR site = p_site)
        GROUP BY 1
    ),
    comments_by_day AS (
        SELECT 
            get_local_date(created_at) AS d,
            COUNT(*)::INTEGER AS cnt
        FROM public.guestbook_comments
        WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date
          AND (p_site IS NULL OR site = p_site)
        GROUP BY 1
    ),
    likes_by_day AS (
        SELECT 
            get_local_date(created_at) AS d,
            COUNT(*)::INTEGER AS cnt
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

-- Drop old signature
DROP FUNCTION IF EXISTS get_community_stats(INTEGER);

-- ============================================
-- 7. ACTIVITY HEATMAP (带站点过滤)
-- ============================================

DROP FUNCTION IF EXISTS get_activity_heatmap(INTEGER, VARCHAR, DATE, DATE);
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
    activity_count BIGINT,
    is_proxy_metric BOOLEAN,
    metric_basis TEXT,
    metric_label TEXT
) AS $$
DECLARE
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
    v_start_date DATE := COALESCE(p_start_date, v_end_date - GREATEST(COALESCE(p_days, 30) - 1, 0));
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    SELECT
        EXTRACT(DOW FROM ue.created_at AT TIME ZONE 'Asia/Shanghai')::INTEGER AS day_of_week,
        EXTRACT(HOUR FROM ue.created_at AT TIME ZONE 'Asia/Shanghai')::INTEGER AS hour_of_day,
        COUNT(*) AS activity_count,
        FALSE AS is_proxy_metric,
        'effective_business_event_heatmap'::TEXT AS metric_basis,
        '真实业务事件热度'::TEXT AS metric_label
    FROM public.user_events ue
    WHERE ue.user_id IS NOT NULL
      AND get_local_date(ue.created_at) BETWEEN v_start_date AND v_end_date
      AND (
          p_site IS NULL
          OR COALESCE(NULLIF(ue.site, ''), NULLIF(ue.event_data->>'site', ''), 'cn') = p_site
      )
      AND ue.event_name IN (
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
    PERFORM public.require_admin_access();

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

DROP FUNCTION IF EXISTS get_points_leaderboard(INTEGER, VARCHAR);

CREATE OR REPLACE FUNCTION get_points_leaderboard(p_limit INTEGER DEFAULT 10, p_site VARCHAR DEFAULT NULL)
RETURNS TABLE (
    user_id UUID,
    username TEXT,
    avatar_url TEXT,
    balance NUMERIC,
    total_spent NUMERIC
) AS $$
BEGIN
    PERFORM public.require_admin_access();

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
    PERFORM public.require_admin_access();

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
    PERFORM public.require_admin_access();

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

-- Drop old signature
DROP FUNCTION IF EXISTS get_ai_summary_data(INTEGER);

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
        SELECT
            ue.user_id,
            ue.event_name
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
            COUNT(DISTINCT user_id) FILTER (WHERE event_name <> 'page_view') AS business_active_users,
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

-- ============================================
-- OVERVIEW WITH TREND (带站点过滤)
-- ============================================

CREATE OR REPLACE FUNCTION get_overview_stats_with_trend(p_site VARCHAR DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_base JSONB;
    v_prev_dau INTEGER;
    v_prev_login_dau INTEGER;
    v_prev_business_dau INTEGER;
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

    -- Previous login DAU reference.
    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT user_id) INTO v_prev_login_dau
        FROM public.user_login_history WHERE get_local_date(created_at) = v_yesterday;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_prev_login_dau
        FROM public.user_login_history WHERE get_local_date(created_at) = v_yesterday AND site = p_site;
    END IF;

    -- Previous business DAU
    SELECT COUNT(DISTINCT ue.user_id)::INTEGER INTO v_prev_business_dau
    FROM public.user_events ue
    WHERE ue.user_id IS NOT NULL
      AND get_local_date(ue.created_at) = v_yesterday
      AND (
          p_site IS NULL
          OR COALESCE(NULLIF(ue.site, ''), NULLIF(ue.event_data->>'site', ''), 'cn') = p_site
      )
      AND ue.event_name IN (
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
      );

    v_prev_dau := COALESCE(v_prev_business_dau, 0);

    -- Previous week new users follows the same global/site attribution semantics as the current window.
    WITH scoped_prev_new_users AS (
        SELECT
            u.id AS user_id,
            get_local_date(u.created_at) AS signup_date
        FROM auth.users u
        WHERE get_local_date(u.created_at) BETWEEN v_prev_window_start AND v_prev_window_end
    ),
    attributed_prev_new_users AS (
        SELECT
            spnu.user_id,
            spnu.signup_date,
            first_touch.site_value AS attributed_site
        FROM scoped_prev_new_users spnu
        LEFT JOIN LATERAL (
            SELECT observed_site.site_value
            FROM (
                SELECT
                    ulh.created_at,
                    CASE
                        WHEN LOWER(BTRIM(COALESCE(ulh.site, ''))) IN ('cn', 'intl')
                            THEN LOWER(BTRIM(ulh.site))
                        ELSE NULL
                    END AS site_value
                FROM public.user_login_history ulh
                WHERE ulh.user_id = spnu.user_id
                UNION ALL
                SELECT
                    ue.created_at,
                    CASE
                        WHEN LOWER(BTRIM(COALESCE(ue.site, ue.event_data->>'site', ''))) IN ('cn', 'intl')
                            THEN LOWER(BTRIM(COALESCE(ue.site, ue.event_data->>'site', '')))
                        ELSE NULL
                    END AS site_value
                FROM public.user_events ue
                WHERE ue.user_id = spnu.user_id
            ) observed_site
            WHERE observed_site.site_value IS NOT NULL
            ORDER BY observed_site.created_at ASC, observed_site.site_value ASC
            LIMIT 1
        ) first_touch ON TRUE
    )
    SELECT
        CASE
            WHEN p_site IS NULL THEN COUNT(*)::INTEGER
            ELSE COUNT(*) FILTER (WHERE attributed_site = p_site)::INTEGER
        END
    INTO v_prev_new_users
    FROM attributed_prev_new_users;

    -- Previous comments
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
        'login_dau_growth', CASE WHEN v_prev_login_dau > 0 THEN ROUND(((v_base->>'login_dau')::NUMERIC - v_prev_login_dau) / v_prev_login_dau * 100) ELSE 0 END,
        'new_users_growth', CASE WHEN v_prev_new_users > 0 THEN ROUND(((v_base->>'new_users_week')::NUMERIC - v_prev_new_users) / v_prev_new_users * 100) ELSE 0 END,
        'comments_growth', CASE WHEN v_prev_comments > 0 THEN ROUND((COALESCE(v_current_comments, 0)::NUMERIC - v_prev_comments) / v_prev_comments * 100) ELSE 0 END
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
GRANT EXECUTE ON FUNCTION get_user_trend(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_content_trend(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_revenue_trend(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_content_top(INTEGER, VARCHAR, INTEGER, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_content_top_v2(INTEGER, VARCHAR, INTEGER, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_community_stats(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_activity_heatmap(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_top_contributors(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_points_leaderboard(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_points_health(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_points_distribution(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ai_summary_data(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ai_summary_data_v2(INTEGER, VARCHAR, DATE, DATE) TO authenticated;

-- ============================================
-- 完成！在 Supabase SQL Editor 中执行本脚本
-- ============================================
