-- ============================================
-- PHASE 11, 13, 14: ADVANCED FEATURES
-- 地理分布、用户埋点、A/B 测试
-- ============================================

-- ============================================
-- PHASE 11: GEO DISTRIBUTION
-- 基于 IP 的地理分布分析
-- ============================================

-- Add geo_info column to user_login_history if not exists
ALTER TABLE public.user_login_history 
ADD COLUMN IF NOT EXISTS geo_info JSONB DEFAULT NULL;

COMMENT ON COLUMN public.user_login_history.geo_info IS 'IP 地理信息 {country, region, city}';

-- Function to get geo distribution
CREATE OR REPLACE FUNCTION get_geo_distribution_by_site(p_site VARCHAR DEFAULT NULL)
RETURNS TABLE (
    region TEXT,
    user_count BIGINT,
    percentage NUMERIC
) AS $$
DECLARE
    v_total BIGINT;
BEGIN
    PERFORM public.require_admin_access();

    -- Get total unique users
    SELECT COUNT(DISTINCT user_id) INTO v_total 
    FROM public.user_login_history
    WHERE geo_info IS NOT NULL
      AND (p_site IS NULL OR site = p_site);

    IF v_total = 0 THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT 
        COALESCE(NULLIF(geo_info->>'region', ''), geo_info->>'country', '未知地区')::TEXT as region,
        COUNT(DISTINCT user_id)::BIGINT as user_count,
        ROUND(COUNT(DISTINCT user_id)::NUMERIC / v_total * 100, 1) as percentage
    FROM public.user_login_history
    WHERE geo_info IS NOT NULL
      AND (p_site IS NULL OR site = p_site)
    GROUP BY COALESCE(NULLIF(geo_info->>'region', ''), geo_info->>'country', '未知地区')
    ORDER BY user_count DESC
    LIMIT 10;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_geo_distribution()
RETURNS TABLE (
    region TEXT,
    user_count BIGINT,
    percentage NUMERIC
) AS $$
BEGIN
    RETURN QUERY SELECT * FROM public.get_geo_distribution_by_site(NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PHASE 13: USER EVENTS (埋点系统)
-- 用户行为追踪表
-- ============================================

CREATE TABLE IF NOT EXISTS public.user_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    session_id TEXT,
    event_type TEXT NOT NULL,
    event_name TEXT NOT NULL,
    event_data JSONB DEFAULT '{}',
    page_url TEXT,
    referrer TEXT,
    user_agent TEXT,
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_user_events_user_id ON public.user_events(user_id);
CREATE INDEX IF NOT EXISTS idx_user_events_event_type ON public.user_events(event_type);
CREATE INDEX IF NOT EXISTS idx_user_events_created_at ON public.user_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_events_session ON public.user_events(session_id);

-- Enable RLS
ALTER TABLE public.user_events ENABLE ROW LEVEL SECURITY;

-- Policy: Users can insert their own events
CREATE POLICY "Users can insert own events" ON public.user_events
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- Policy: Admins can read all events
CREATE POLICY "Admins can read all events" ON public.user_events
    FOR SELECT TO authenticated
    USING (public.is_admin());

-- Function: Track event (for frontend SDK)
CREATE OR REPLACE FUNCTION track_event(
    p_event_type TEXT,
    p_event_name TEXT,
    p_event_data JSONB DEFAULT '{}',
    p_page_url TEXT DEFAULT NULL,
    p_session_id TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_event_id UUID;
BEGIN
    INSERT INTO public.user_events (
        user_id, session_id, event_type, event_name, 
        event_data, page_url, created_at
    ) VALUES (
        auth.uid(), p_session_id, p_event_type, p_event_name,
        p_event_data, p_page_url, NOW()
    )
    RETURNING id INTO v_event_id;
    
    RETURN v_event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get event funnel analysis
CREATE OR REPLACE FUNCTION get_event_funnel(
    p_event_names TEXT[],
    p_days INTEGER DEFAULT 30
)
RETURNS TABLE (
    step_name TEXT,
    step_order INTEGER,
    user_count BIGINT,
    conversion_rate NUMERIC
) AS $$
DECLARE
    v_start_date TIMESTAMPTZ := NOW() - (p_days || ' days')::INTERVAL;
    v_first_step_count BIGINT;
    i INTEGER;
BEGIN
    -- Get first step count
    SELECT COUNT(DISTINCT user_id) INTO v_first_step_count
    FROM public.user_events
    WHERE event_name = p_event_names[1]
      AND created_at >= v_start_date;

    -- Return each step
    FOR i IN 1..array_length(p_event_names, 1) LOOP
        RETURN QUERY
        SELECT 
            p_event_names[i]::TEXT,
            i,
            COUNT(DISTINCT user_id)::BIGINT,
            ROUND(COUNT(DISTINCT user_id)::NUMERIC / NULLIF(v_first_step_count, 0) * 100, 1)
        FROM public.user_events
        WHERE event_name = p_event_names[i]
          AND created_at >= v_start_date;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- PHASE 14: A/B TESTING
-- 实验框架
-- ============================================

-- Experiments table
CREATE TABLE IF NOT EXISTS public.ab_experiments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'paused', 'completed')),
    variants JSONB NOT NULL DEFAULT '[{"name": "Control", "weight": 50}, {"name": "Variant A", "weight": 50}]',
    target_metric TEXT,
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User assignments to experiments
CREATE TABLE IF NOT EXISTS public.ab_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID REFERENCES public.ab_experiments(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    variant_name TEXT NOT NULL,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(experiment_id, user_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_ab_experiments_status ON public.ab_experiments(status);
CREATE INDEX IF NOT EXISTS idx_ab_assignments_experiment ON public.ab_assignments(experiment_id);
CREATE INDEX IF NOT EXISTS idx_ab_assignments_user ON public.ab_assignments(user_id);

-- Enable RLS
ALTER TABLE public.ab_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ab_assignments ENABLE ROW LEVEL SECURITY;

-- Policies: Only admins can manage experiments
CREATE POLICY "Admins can manage experiments" ON public.ab_experiments
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY "Users can read own assignments" ON public.ab_assignments
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage assignments" ON public.ab_assignments
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Function: Get user's experiment variant
CREATE OR REPLACE FUNCTION get_experiment_variant(p_experiment_name TEXT)
RETURNS TEXT AS $$
DECLARE
    v_experiment_id UUID;
    v_variant TEXT;
    v_variants JSONB;
    v_random NUMERIC;
    v_cumulative NUMERIC := 0;
    v_variant_item JSONB;
BEGIN
    -- Get experiment
    SELECT id, variants INTO v_experiment_id, v_variants
    FROM public.ab_experiments
    WHERE name = p_experiment_name AND status = 'running';

    IF v_experiment_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Check existing assignment
    SELECT variant_name INTO v_variant
    FROM public.ab_assignments
    WHERE experiment_id = v_experiment_id AND user_id = auth.uid();

    IF v_variant IS NOT NULL THEN
        RETURN v_variant;
    END IF;

    -- Assign based on weights
    v_random := random() * 100;
    
    FOR v_variant_item IN SELECT * FROM jsonb_array_elements(v_variants)
    LOOP
        v_cumulative := v_cumulative + (v_variant_item->>'weight')::NUMERIC;
        IF v_random <= v_cumulative THEN
            v_variant := v_variant_item->>'name';
            EXIT;
        END IF;
    END LOOP;

    -- Save assignment
    INSERT INTO public.ab_assignments (experiment_id, user_id, variant_name)
    VALUES (v_experiment_id, auth.uid(), v_variant);

    RETURN v_variant;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get experiment results
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

-- Function: Get experiment results
CREATE OR REPLACE FUNCTION get_experiment_results(p_experiment_id UUID)
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
        COUNT(DISTINCT a.user_id)::BIGINT as user_count,
        COUNT(DISTINCT c.user_id)::BIGINT as conversion_count,
        ROUND(
            COUNT(DISTINCT c.user_id)::NUMERIC
            / NULLIF(COUNT(DISTINCT a.user_id), 0) * 100,
            1
        ) as conversion_rate
    FROM assignment_base a
    LEFT JOIN conversions c
      ON c.variant_name = a.variant_name
     AND c.user_id = a.user_id
    GROUP BY a.variant_name
    ORDER BY a.variant_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_experiment_results_v2(p_experiment_id UUID)
RETURNS TABLE (
    dimension_type TEXT,
    dimension_value TEXT,
    variant_name TEXT,
    assigned_user_count BIGINT,
    exposure_user_count BIGINT,
    conversion_count BIGINT,
    conversion_rate NUMERIC
) AS $$
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    WITH experiment AS (
        SELECT
            e.id,
            LOWER(BTRIM(COALESCE(e.name, ''))) AS experiment_name_key,
            LOWER(BTRIM(COALESCE(NULLIF(e.target_metric, ''), 'engagement'))) AS target_metric_key,
            CASE
                WHEN LOWER(BTRIM(COALESCE(e.target_metric, ''))) IN ('', 'page_view', 'button_click', 'signup', 'purchase', 'engagement') THEN FALSE
                ELSE TRUE
            END AS require_context
        FROM public.ab_experiments e
        WHERE e.id = p_experiment_id
    ),
    assignment_base AS (
        SELECT
            a.user_id,
            a.variant_name,
            LOWER(BTRIM(COALESCE(a.variant_name, ''))) AS variant_name_key,
            a.assigned_at
        FROM public.ab_assignments a
        WHERE a.experiment_id = p_experiment_id
    ),
    exposure_events AS (
        SELECT DISTINCT ON (
            a.user_id,
            a.variant_name_key,
            COALESCE(NULLIF(LOWER(BTRIM(COALESCE(ue.site, ue.event_data->>'site', ''))), ''), 'cn'),
            COALESCE(NULLIF(LOWER(BTRIM(COALESCE(ue.event_data->'metadata'->>'placement', ue.event_data->>'placement', ''))), ''), 'default')
        )
            a.user_id,
            a.variant_name,
            a.variant_name_key,
            COALESCE(NULLIF(LOWER(BTRIM(COALESCE(ue.site, ue.event_data->>'site', ''))), ''), 'cn') AS site_value,
            COALESCE(NULLIF(LOWER(BTRIM(COALESCE(ue.event_data->'metadata'->>'placement', ue.event_data->>'placement', ''))), ''), 'default') AS placement_value,
            ue.created_at AS exposed_at
        FROM assignment_base a
        CROSS JOIN experiment e
        JOIN public.user_events ue
          ON ue.user_id = a.user_id
         AND ue.created_at >= a.assigned_at
         AND LOWER(BTRIM(COALESCE(ue.event_name, ''))) = 'experiment_exposure'
         AND (
            LOWER(BTRIM(COALESCE(ue.event_data->>'experiment_id', ''))) IN (e.experiment_name_key, LOWER(e.id::TEXT))
            OR LOWER(BTRIM(COALESCE(ue.event_data->'metadata'->>'experiment_name', ''))) = e.experiment_name_key
         )
         AND (
            LOWER(BTRIM(COALESCE(ue.event_data->>'variant_id', ''))) = a.variant_name_key
            OR LOWER(BTRIM(COALESCE(ue.event_data->'metadata'->>'variant_name', ''))) = a.variant_name_key
         )
        ORDER BY
            a.user_id,
            a.variant_name_key,
            site_value,
            placement_value,
            ue.created_at
    ),
    exposed_overall AS (
        SELECT
            user_id,
            variant_name,
            variant_name_key,
            MIN(exposed_at) AS exposed_at
        FROM exposure_events
        GROUP BY user_id, variant_name, variant_name_key
    ),
    exposed_by_site AS (
        SELECT
            user_id,
            variant_name,
            variant_name_key,
            site_value AS dimension_value,
            MIN(exposed_at) AS exposed_at
        FROM exposure_events
        GROUP BY user_id, variant_name, variant_name_key, site_value
    ),
    exposed_by_placement AS (
        SELECT
            user_id,
            variant_name,
            variant_name_key,
            placement_value AS dimension_value,
            MIN(exposed_at) AS exposed_at
        FROM exposure_events
        GROUP BY user_id, variant_name, variant_name_key, placement_value
    ),
    conversion_events AS (
        SELECT
            ue.user_id,
            ue.created_at,
            LOWER(BTRIM(COALESCE(ue.event_name, ''))) AS event_name_key,
            LOWER(BTRIM(COALESCE(ue.event_type, ''))) AS event_type_key,
            LOWER(BTRIM(COALESCE(ue.event_data->>'experiment_id', ''))) AS experiment_id_key,
            LOWER(BTRIM(COALESCE(ue.event_data->'metadata'->>'experiment_name', ''))) AS experiment_name_key,
            LOWER(BTRIM(COALESCE(ue.event_data->>'variant_id', ''))) AS variant_id_key,
            LOWER(BTRIM(COALESCE(ue.event_data->'metadata'->>'variant_name', ''))) AS variant_name_key
        FROM public.user_events ue
        WHERE ue.user_id IS NOT NULL
    ),
    overall_conversions AS (
        SELECT DISTINCT
            eo.variant_name,
            eo.variant_name_key,
            eo.user_id
        FROM exposed_overall eo
        CROSS JOIN experiment e
        JOIN conversion_events ce
          ON ce.user_id = eo.user_id
         AND ce.created_at >= eo.exposed_at
         AND public.experiment_metric_matches_event(e.target_metric_key, ce.event_name_key, ce.event_type_key)
         AND (
            CASE
                WHEN e.require_context THEN
                    (
                        ce.experiment_id_key IN (e.experiment_name_key, LOWER(e.id::TEXT))
                        OR ce.experiment_name_key = e.experiment_name_key
                    )
                    AND (
                        ce.variant_id_key = eo.variant_name_key
                        OR ce.variant_name_key = eo.variant_name_key
                    )
                ELSE TRUE
            END
         )
    ),
    site_conversions AS (
        SELECT DISTINCT
            es.dimension_value,
            es.variant_name,
            es.variant_name_key,
            es.user_id
        FROM exposed_by_site es
        CROSS JOIN experiment e
        JOIN conversion_events ce
          ON ce.user_id = es.user_id
         AND ce.created_at >= es.exposed_at
         AND public.experiment_metric_matches_event(e.target_metric_key, ce.event_name_key, ce.event_type_key)
         AND (
            CASE
                WHEN e.require_context THEN
                    (
                        ce.experiment_id_key IN (e.experiment_name_key, LOWER(e.id::TEXT))
                        OR ce.experiment_name_key = e.experiment_name_key
                    )
                    AND (
                        ce.variant_id_key = es.variant_name_key
                        OR ce.variant_name_key = es.variant_name_key
                    )
                ELSE TRUE
            END
         )
    ),
    placement_conversions AS (
        SELECT DISTINCT
            ep.dimension_value,
            ep.variant_name,
            ep.variant_name_key,
            ep.user_id
        FROM exposed_by_placement ep
        CROSS JOIN experiment e
        JOIN conversion_events ce
          ON ce.user_id = ep.user_id
         AND ce.created_at >= ep.exposed_at
         AND public.experiment_metric_matches_event(e.target_metric_key, ce.event_name_key, ce.event_type_key)
         AND (
            CASE
                WHEN e.require_context THEN
                    (
                        ce.experiment_id_key IN (e.experiment_name_key, LOWER(e.id::TEXT))
                        OR ce.experiment_name_key = e.experiment_name_key
                    )
                    AND (
                        ce.variant_id_key = ep.variant_name_key
                        OR ce.variant_name_key = ep.variant_name_key
                    )
                ELSE TRUE
            END
         )
    ),
    overall_rows AS (
        SELECT
            'overall'::TEXT AS dimension_type,
            'all'::TEXT AS dimension_value,
            a.variant_name::TEXT,
            COUNT(DISTINCT a.user_id)::BIGINT AS assigned_user_count,
            COUNT(DISTINCT eo.user_id)::BIGINT AS exposure_user_count,
            COUNT(DISTINCT oc.user_id)::BIGINT AS conversion_count,
            ROUND(
                COUNT(DISTINCT oc.user_id)::NUMERIC
                / NULLIF(COUNT(DISTINCT eo.user_id), 0) * 100,
                1
            ) AS conversion_rate
        FROM assignment_base a
        LEFT JOIN exposed_overall eo
          ON eo.user_id = a.user_id
         AND eo.variant_name_key = a.variant_name_key
        LEFT JOIN overall_conversions oc
          ON oc.user_id = a.user_id
         AND oc.variant_name_key = a.variant_name_key
        GROUP BY a.variant_name
    ),
    site_rows AS (
        SELECT
            'site'::TEXT AS dimension_type,
            es.dimension_value::TEXT,
            es.variant_name::TEXT,
            COUNT(DISTINCT es.user_id)::BIGINT AS assigned_user_count,
            COUNT(DISTINCT es.user_id)::BIGINT AS exposure_user_count,
            COUNT(DISTINCT sc.user_id)::BIGINT AS conversion_count,
            ROUND(
                COUNT(DISTINCT sc.user_id)::NUMERIC
                / NULLIF(COUNT(DISTINCT es.user_id), 0) * 100,
                1
            ) AS conversion_rate
        FROM exposed_by_site es
        LEFT JOIN site_conversions sc
          ON sc.user_id = es.user_id
         AND sc.variant_name_key = es.variant_name_key
         AND sc.dimension_value = es.dimension_value
        GROUP BY es.dimension_value, es.variant_name
    ),
    placement_rows AS (
        SELECT
            'placement'::TEXT AS dimension_type,
            ep.dimension_value::TEXT,
            ep.variant_name::TEXT,
            COUNT(DISTINCT ep.user_id)::BIGINT AS assigned_user_count,
            COUNT(DISTINCT ep.user_id)::BIGINT AS exposure_user_count,
            COUNT(DISTINCT pc.user_id)::BIGINT AS conversion_count,
            ROUND(
                COUNT(DISTINCT pc.user_id)::NUMERIC
                / NULLIF(COUNT(DISTINCT ep.user_id), 0) * 100,
                1
            ) AS conversion_rate
        FROM exposed_by_placement ep
        LEFT JOIN placement_conversions pc
          ON pc.user_id = ep.user_id
         AND pc.variant_name_key = ep.variant_name_key
         AND pc.dimension_value = ep.dimension_value
        GROUP BY ep.dimension_value, ep.variant_name
    )
    SELECT *
    FROM (
        SELECT * FROM overall_rows
        UNION ALL
        SELECT * FROM site_rows
        UNION ALL
        SELECT * FROM placement_rows
    ) AS result_rows
    ORDER BY
        CASE result_rows.dimension_type
            WHEN 'overall' THEN 0
            WHEN 'site' THEN 1
            ELSE 2
        END,
        result_rows.dimension_value,
        result_rows.variant_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- GRANT PERMISSIONS
-- ============================================

GRANT EXECUTE ON FUNCTION get_geo_distribution_by_site(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_geo_distribution() TO authenticated;
GRANT EXECUTE ON FUNCTION public.experiment_metric_matches_event(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION track_event(TEXT, TEXT, JSONB, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_event_funnel(TEXT[], INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_experiment_variant(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_experiment_results(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_experiment_results_v2(UUID) TO authenticated;
