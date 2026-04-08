-- Align admin analytics site attribution for new users and retention cohorts.
-- This migration makes CN / INTL views use the same first-site attribution model
-- for overview KPIs, user trend, trend growth, and retention denominators.

CREATE OR REPLACE FUNCTION get_overview_stats(p_site VARCHAR DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_dau INTEGER;
    v_mau INTEGER;
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

    IF p_site IS NULL THEN
        SELECT COALESCE(SUM(total_balance), 0) INTO v_total_points_circulation
        FROM public.points_balance;
    ELSE
        SELECT COALESCE(SUM(total_balance), 0) INTO v_total_points_circulation
        FROM public.points_balance WHERE site = p_site;
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

DROP FUNCTION IF EXISTS get_overview_stats();

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
    active_users_by_day AS (
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
        COALESCE(au.cnt, 0) AS active_users
    FROM date_series ds
    LEFT JOIN new_users_by_day nu ON nu.d = ds.d
    LEFT JOIN active_users_by_day au ON au.d = ds.d
    ORDER BY ds.d ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_user_trend(INTEGER, VARCHAR);
DROP FUNCTION IF EXISTS get_user_trend(INTEGER);

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
        FROM public.user_login_history WHERE get_local_date(created_at) = v_yesterday;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_prev_dau
        FROM public.user_login_history WHERE get_local_date(created_at) = v_yesterday AND site = p_site;
    END IF;

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

DROP FUNCTION IF EXISTS get_overview_stats_with_trend();

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
    PERFORM public.require_admin_access();

    RETURN QUERY
    WITH cohort_source AS (
        SELECT
            u.id as user_id,
            date_trunc('week', u.created_at AT TIME ZONE 'Asia/Shanghai')::date as cohort_date
        FROM auth.users u
        WHERE u.created_at >= NOW() - (p_weeks || ' weeks')::INTERVAL
    ),
    attributed_cohorts AS (
        SELECT
            cs.user_id,
            cs.cohort_date,
            first_touch.site_value AS attributed_site
        FROM cohort_source cs
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
                WHERE ulh.user_id = cs.user_id
                UNION ALL
                SELECT
                    ue.created_at,
                    CASE
                        WHEN LOWER(BTRIM(COALESCE(ue.site, ue.event_data->>'site', ''))) IN ('cn', 'intl')
                            THEN LOWER(BTRIM(COALESCE(ue.site, ue.event_data->>'site', '')))
                        ELSE NULL
                    END AS site_value
                FROM public.user_events ue
                WHERE ue.user_id = cs.user_id
            ) observed_site
            WHERE observed_site.site_value IS NOT NULL
            ORDER BY observed_site.created_at ASC, observed_site.site_value ASC
            LIMIT 1
        ) first_touch ON TRUE
    ),
    cohorts AS (
        SELECT
            ac.user_id,
            ac.cohort_date
        FROM attributed_cohorts ac
        WHERE p_site IS NULL OR ac.attributed_site = p_site
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

DROP FUNCTION IF EXISTS get_retention_cohort(INTEGER);

GRANT EXECUTE ON FUNCTION get_overview_stats(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_overview_stats_with_trend(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_trend(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_retention_cohort(INTEGER, VARCHAR) TO authenticated;
