-- Align admin analytics active-user semantics with business events.
-- This migration promotes effective user_events to the primary DAU/MAU/active_users
-- metric while retaining login activity as a reference field.

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

DROP FUNCTION IF EXISTS get_overview_stats();
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

DROP FUNCTION IF EXISTS get_user_trend(INTEGER);

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

    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT user_id) INTO v_prev_login_dau
        FROM public.user_login_history WHERE get_local_date(created_at) = v_yesterday;
    ELSE
        SELECT COUNT(DISTINCT user_id) INTO v_prev_login_dau
        FROM public.user_login_history WHERE get_local_date(created_at) = v_yesterday AND site = p_site;
    END IF;

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
        'login_dau_growth', CASE WHEN v_prev_login_dau > 0 THEN ROUND(((v_base->>'login_dau')::NUMERIC - v_prev_login_dau) / v_prev_login_dau * 100) ELSE 0 END,
        'new_users_growth', CASE WHEN v_prev_new_users > 0 THEN ROUND(((v_base->>'new_users_week')::NUMERIC - v_prev_new_users) / v_prev_new_users * 100) ELSE 0 END,
        'comments_growth', CASE WHEN v_prev_comments > 0 THEN ROUND((COALESCE(v_current_comments, 0)::NUMERIC - v_prev_comments) / v_prev_comments * 100) ELSE 0 END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_overview_stats_with_trend();

DROP FUNCTION IF EXISTS get_ai_summary_data_v2(INTEGER, VARCHAR, DATE, DATE);

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

GRANT EXECUTE ON FUNCTION get_overview_stats(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_overview_stats_with_trend(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_trend(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_ai_summary_data_v2(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
