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
            (COALESCE(e.target_metric, '') <> '' AND ue.event_name = e.target_metric)
            OR (
                COALESCE(e.target_metric, '') = ''
                AND ue.event_type = 'conversion'
            )
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

-- ============================================
-- GRANT PERMISSIONS
-- ============================================

GRANT EXECUTE ON FUNCTION get_geo_distribution_by_site(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_geo_distribution() TO authenticated;
GRANT EXECUTE ON FUNCTION track_event(TEXT, TEXT, JSONB, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_event_funnel(TEXT[], INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_experiment_variant(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_experiment_results(UUID) TO authenticated;
