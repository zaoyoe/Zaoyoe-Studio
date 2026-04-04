-- ============================================
-- Phase 3: A/B experiment results align to real event metrics
-- ============================================

CREATE OR REPLACE FUNCTION public.experiment_metric_matches_event(
    p_target_metric TEXT,
    p_event_name TEXT,
    p_event_type TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_target_metric TEXT := LOWER(TRIM(COALESCE(p_target_metric, '')));
    v_event_name TEXT := LOWER(TRIM(COALESCE(p_event_name, '')));
    v_event_type TEXT := LOWER(TRIM(COALESCE(p_event_type, '')));
BEGIN
    IF v_target_metric = '' THEN
        RETURN v_event_type = 'conversion';
    END IF;

    IF v_event_name = v_target_metric THEN
        RETURN TRUE;
    END IF;

    CASE v_target_metric
        WHEN 'purchase' THEN
            RETURN v_event_name IN ('recharge_success', 'shop_purchase');
        WHEN 'engagement' THEN
            RETURN v_event_name IN ('prompt_view', 'unlock_success', 'guestbook_post', 'affiliate_invite_click', 'checkin_success');
        WHEN 'button_click' THEN
            RETURN v_event_name IN ('unlock_click', 'recharge_click', 'verify_submit', 'shop_view', 'wallet_open', 'affiliate_invite_click');
        WHEN 'signup' THEN
            RETURN v_event_name IN ('signup', 'signup_success', 'register_success');
        WHEN 'page_view' THEN
            RETURN v_event_name = 'page_view';
        ELSE
            RETURN FALSE;
    END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.get_experiment_results(p_experiment_id UUID)
RETURNS TABLE (
    variant_name TEXT,
    user_count BIGINT,
    conversion_count BIGINT,
    conversion_rate NUMERIC
) AS $$
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    WITH experiment AS (
        SELECT id, target_metric
        FROM public.ab_experiments
        WHERE id = p_experiment_id
    ),
    assignment_base AS (
        SELECT a.user_id, a.variant_name, a.assigned_at
        FROM public.ab_assignments a
        WHERE a.experiment_id = p_experiment_id
    ),
    conversions AS (
        SELECT DISTINCT
            a.variant_name,
            a.user_id
        FROM assignment_base a
        CROSS JOIN experiment e
        JOIN public.user_events ue
          ON ue.user_id = a.user_id
         AND ue.created_at >= a.assigned_at
         AND (
            public.experiment_metric_matches_event(e.target_metric, ue.event_name, ue.event_type)
            OR COALESCE(ue.event_data->>'experiment_id', '') = p_experiment_id::TEXT
         )
    )
    SELECT
        a.variant_name::TEXT,
        COUNT(DISTINCT a.user_id)::BIGINT AS user_count,
        COUNT(DISTINCT c.user_id)::BIGINT AS conversion_count,
        ROUND(
            COUNT(DISTINCT c.user_id)::NUMERIC
            / NULLIF(COUNT(DISTINCT a.user_id), 0) * 100,
            1
        ) AS conversion_rate
    FROM assignment_base a
    LEFT JOIN conversions c
      ON c.variant_name = a.variant_name
     AND c.user_id = a.user_id
    GROUP BY a.variant_name
    ORDER BY a.variant_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.experiment_metric_matches_event(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_experiment_results(UUID) TO authenticated;
