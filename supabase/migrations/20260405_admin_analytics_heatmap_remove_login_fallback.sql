-- Retire the analytics activity heatmap login-history fallback so the
-- panel always reflects real business events. If there are no business
-- events in the selected window, the heatmap should be empty rather than
-- silently reverting to a proxy metric.

DROP FUNCTION IF EXISTS get_activity_heatmap(INTEGER, VARCHAR, DATE, DATE);

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

DROP FUNCTION IF EXISTS get_activity_heatmap(INTEGER, VARCHAR);
DROP FUNCTION IF EXISTS get_activity_heatmap(INTEGER);

GRANT EXECUTE ON FUNCTION get_activity_heatmap(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
