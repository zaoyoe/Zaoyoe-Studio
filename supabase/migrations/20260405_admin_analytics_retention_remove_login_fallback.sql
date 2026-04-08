-- Retire the retention login-history fallback so the retention panel
-- always reflects real business revisit activity. If the selected
-- window has no business events, the cohort should be empty instead of
-- silently reverting to login-only activity.

DROP FUNCTION IF EXISTS get_retention_cohort(INTEGER, VARCHAR, DATE, DATE);

CREATE OR REPLACE FUNCTION get_retention_cohort(
    p_weeks INTEGER DEFAULT 8,
    p_site VARCHAR DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    cohort_week TEXT,
    week_0 INTEGER,
    week_1 INTEGER,
    week_2 INTEGER,
    week_3 INTEGER,
    week_4 INTEGER,
    is_proxy_metric BOOLEAN,
    metric_basis TEXT,
    metric_label TEXT
) AS $$
DECLARE
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
    v_start_date DATE := COALESCE(
        p_start_date,
        v_end_date - GREATEST(COALESCE(p_weeks, 8) * 7 - 1, 0)
    );
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    WITH cohort_source AS (
        SELECT
            u.id as user_id,
            date_trunc('week', u.created_at AT TIME ZONE 'Asia/Shanghai')::date as cohort_date
        FROM auth.users u
        WHERE get_local_date(u.created_at) BETWEEN v_start_date AND v_end_date
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
            ue.user_id,
            date_trunc('week', ue.created_at AT TIME ZONE 'Asia/Shanghai')::date as activity_week
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
        ROUND(w4::NUMERIC / NULLIF(cohort_size, 0) * 100)::INTEGER as week_4,
        FALSE AS is_proxy_metric,
        'site_attributed_cohort_effective_business_activity'::TEXT AS metric_basis,
        '首站点归因 cohort + 真实业务回访'::TEXT AS metric_label
    FROM retention;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS get_retention_cohort(INTEGER, VARCHAR);
DROP FUNCTION IF EXISTS get_retention_cohort(INTEGER);

GRANT EXECUTE ON FUNCTION get_retention_cohort(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
