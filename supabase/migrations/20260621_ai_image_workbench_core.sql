-- Core persistence for the AI image workbench.
-- The public API writes through the service role; authenticated users only read
-- their own tasks, results, and usage records.

CREATE TABLE IF NOT EXISTS public.ai_image_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site TEXT NOT NULL DEFAULT 'cn'
        CHECK (site IN ('all', 'cn', 'intl')),
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    name_en TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    description_en TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT 'agent'
        CONSTRAINT ai_image_agents_mode_check
        CHECK (mode IN ('agent', 'text', 'image', 'video', 'reverse', 'chat')),
    default_model TEXT NOT NULL DEFAULT '',
    default_ratio TEXT NOT NULL DEFAULT '1:1',
    default_resolution TEXT NOT NULL DEFAULT '1k'
        CONSTRAINT ai_image_agents_default_resolution_check
        CHECK (default_resolution IN ('1k', '2k', '4k', '480p', '720p', '1080p')),
    pricing_override JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_image_agents_site_slug_unique UNIQUE (site, slug)
);

CREATE TABLE IF NOT EXISTS public.ai_image_pricing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site TEXT NOT NULL DEFAULT 'all'
        CHECK (site IN ('all', 'cn', 'intl')),
    mode TEXT NOT NULL DEFAULT 'text'
        CONSTRAINT ai_image_pricing_rules_mode_check
        CHECK (mode IN ('text', 'image', 'video', 'reverse', 'chat', 'agent')),
    billing_mode TEXT NOT NULL DEFAULT 'points'
        CHECK (billing_mode IN ('points', 'api')),
    model TEXT NOT NULL DEFAULT '*',
    resolution TEXT NOT NULL DEFAULT '*',
    ratio TEXT NOT NULL DEFAULT '*',
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1 AND quantity <= 8),
    points NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (points >= 0),
    priority INTEGER NOT NULL DEFAULT 100,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_image_api_base_urls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site TEXT NOT NULL DEFAULT 'all'
        CHECK (site IN ('all', 'cn', 'intl')),
    label TEXT NOT NULL DEFAULT '',
    base_url TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_image_api_base_urls_unique UNIQUE (site, base_url)
);

CREATE TABLE IF NOT EXISTS public.ai_image_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site TEXT NOT NULL DEFAULT 'cn'
        CHECK (site IN ('cn', 'intl')),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    parent_task_id UUID REFERENCES public.ai_image_tasks(id) ON DELETE SET NULL,
    conversation_id UUID,
    client_task_id TEXT NOT NULL DEFAULT '',
    source_prompt_id TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT 'text'
        CONSTRAINT ai_image_tasks_mode_check
        CHECK (mode IN ('text', 'image', 'video', 'reverse', 'chat', 'agent')),
    agent_id UUID REFERENCES public.ai_image_agents(id) ON DELETE SET NULL,
    agent_slug TEXT NOT NULL DEFAULT '',
    billing_mode TEXT NOT NULL
        CHECK (billing_mode IN ('points', 'api')),
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'refunded')),
    model TEXT NOT NULL DEFAULT '',
    api_model_group TEXT NOT NULL DEFAULT '',
    ratio TEXT,
    resolution TEXT
        CONSTRAINT ai_image_tasks_resolution_check
        CHECK (resolution IS NULL OR resolution IN ('1k', '2k', '4k', '480p', '720p', '1080p')),
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1 AND quantity <= 8),
    prompt TEXT NOT NULL DEFAULT '',
    negative_prompt TEXT NOT NULL DEFAULT '',
    reference_image_url TEXT NOT NULL DEFAULT '',
    reference_image_storage_path TEXT NOT NULL DEFAULT '',
    reference_title TEXT NOT NULL DEFAULT '',
    result_prompt TEXT NOT NULL DEFAULT '',
    estimated_points NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (estimated_points >= 0),
    charged_points NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (charged_points >= 0),
    points_ledger_reference_id TEXT NOT NULL DEFAULT '',
    api_base_url TEXT NOT NULL DEFAULT '',
    api_key_tail TEXT NOT NULL DEFAULT '',
    api_key_fingerprint TEXT NOT NULL DEFAULT '',
    token_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
    input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
    provider_task_id TEXT NOT NULL DEFAULT '',
    error_code TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_image_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.ai_image_tasks(id) ON DELETE CASCADE,
    site TEXT NOT NULL DEFAULT 'cn'
        CHECK (site IN ('cn', 'intl')),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    result_index INTEGER NOT NULL DEFAULT 0 CHECK (result_index >= 0),
    image_url TEXT NOT NULL DEFAULT '',
    original_image_url TEXT NOT NULL DEFAULT '',
    storage_path TEXT NOT NULL DEFAULT '',
    original_storage_path TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT 'image/png',
    width INTEGER CHECK (width IS NULL OR width > 0),
    height INTEGER CHECK (height IS NULL OR height > 0),
    ratio TEXT NOT NULL DEFAULT '',
    resolution TEXT
        CONSTRAINT ai_image_results_resolution_check
        CHECK (resolution IS NULL OR resolution IN ('1k', '2k', '4k', '480p', '720p', '1080p')),
    prompt TEXT NOT NULL DEFAULT '',
    revised_prompt TEXT NOT NULL DEFAULT '',
    seed TEXT NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_image_api_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES public.ai_image_tasks(id) ON DELETE SET NULL,
    site TEXT NOT NULL DEFAULT 'cn'
        CHECK (site IN ('cn', 'intl')),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    api_base_url TEXT NOT NULL DEFAULT '',
    api_key_tail TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    model_group TEXT NOT NULL DEFAULT '',
    request_type TEXT NOT NULL DEFAULT 'chat'
        CONSTRAINT ai_image_api_usage_request_type_check
        CHECK (request_type IN ('chat', 'text', 'image', 'video', 'reverse', 'agent')),
    input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
    total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
    image_count INTEGER NOT NULL DEFAULT 0 CHECK (image_count >= 0),
    resolution TEXT
        CONSTRAINT ai_image_api_usage_resolution_check
        CHECK (resolution IS NULL OR resolution IN ('1k', '2k', '4k', '480p', '720p', '1080p')),
    raw_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_image_download_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES public.ai_image_tasks(id) ON DELETE SET NULL,
    result_id UUID REFERENCES public.ai_image_results(id) ON DELETE SET NULL,
    site TEXT NOT NULL DEFAULT 'cn'
        CHECK (site IN ('cn', 'intl')),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL DEFAULT '',
    original_image_url TEXT NOT NULL DEFAULT '',
    storage_path TEXT NOT NULL DEFAULT '',
    original_storage_path TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'workbench',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_image_agents_site_active_order
    ON public.ai_image_agents (site, is_active, display_order, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_image_pricing_rules_lookup
    ON public.ai_image_pricing_rules (site, mode, billing_mode, model, resolution, ratio, is_active, priority);

CREATE INDEX IF NOT EXISTS idx_ai_image_api_base_urls_site_active_order
    ON public.ai_image_api_base_urls (site, is_active, display_order, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_image_tasks_user_site_created
    ON public.ai_image_tasks (user_id, site, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_image_tasks_parent_created
    ON public.ai_image_tasks (parent_task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_image_tasks_status_created
    ON public.ai_image_tasks (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_image_results_task_index
    ON public.ai_image_results (task_id, result_index, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_image_results_user_site_created
    ON public.ai_image_results (user_id, site, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_image_api_usage_user_site_created
    ON public.ai_image_api_usage (user_id, site, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_image_download_events_user_site_created
    ON public.ai_image_download_events (user_id, site, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_image_download_events_task_created
    ON public.ai_image_download_events (task_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.fn_touch_ai_image_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_image_agents_touch_updated_at ON public.ai_image_agents;
CREATE TRIGGER trg_ai_image_agents_touch_updated_at
BEFORE INSERT OR UPDATE ON public.ai_image_agents
FOR EACH ROW
EXECUTE FUNCTION public.fn_touch_ai_image_updated_at();

DROP TRIGGER IF EXISTS trg_ai_image_pricing_rules_touch_updated_at ON public.ai_image_pricing_rules;
CREATE TRIGGER trg_ai_image_pricing_rules_touch_updated_at
BEFORE INSERT OR UPDATE ON public.ai_image_pricing_rules
FOR EACH ROW
EXECUTE FUNCTION public.fn_touch_ai_image_updated_at();

DROP TRIGGER IF EXISTS trg_ai_image_api_base_urls_touch_updated_at ON public.ai_image_api_base_urls;
CREATE TRIGGER trg_ai_image_api_base_urls_touch_updated_at
BEFORE INSERT OR UPDATE ON public.ai_image_api_base_urls
FOR EACH ROW
EXECUTE FUNCTION public.fn_touch_ai_image_updated_at();

DROP TRIGGER IF EXISTS trg_ai_image_tasks_touch_updated_at ON public.ai_image_tasks;
CREATE TRIGGER trg_ai_image_tasks_touch_updated_at
BEFORE INSERT OR UPDATE ON public.ai_image_tasks
FOR EACH ROW
EXECUTE FUNCTION public.fn_touch_ai_image_updated_at();

ALTER TABLE public.ai_image_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_image_pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_image_api_base_urls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_image_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_image_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_image_api_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_image_download_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE public.ai_image_agents TO anon, authenticated;
GRANT SELECT ON TABLE public.ai_image_pricing_rules TO authenticated;
GRANT SELECT ON TABLE public.ai_image_api_base_urls TO authenticated;
GRANT SELECT ON TABLE public.ai_image_tasks TO authenticated;
GRANT SELECT ON TABLE public.ai_image_results TO authenticated;
GRANT SELECT ON TABLE public.ai_image_api_usage TO authenticated;
GRANT SELECT ON TABLE public.ai_image_download_events TO authenticated;

DROP POLICY IF EXISTS "Public read active ai image agents" ON public.ai_image_agents;
CREATE POLICY "Public read active ai image agents"
    ON public.ai_image_agents
    FOR SELECT TO anon, authenticated
    USING (is_active = TRUE);

DROP POLICY IF EXISTS "Admins manage ai image agents" ON public.ai_image_agents;
CREATE POLICY "Admins manage ai image agents"
    ON public.ai_image_agents
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users read active ai image pricing rules" ON public.ai_image_pricing_rules;
CREATE POLICY "Users read active ai image pricing rules"
    ON public.ai_image_pricing_rules
    FOR SELECT TO authenticated
    USING (is_active = TRUE OR public.is_admin());

DROP POLICY IF EXISTS "Admins manage ai image pricing rules" ON public.ai_image_pricing_rules;
CREATE POLICY "Admins manage ai image pricing rules"
    ON public.ai_image_pricing_rules
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users read active ai image api base urls" ON public.ai_image_api_base_urls;
CREATE POLICY "Users read active ai image api base urls"
    ON public.ai_image_api_base_urls
    FOR SELECT TO authenticated
    USING (is_active = TRUE OR public.is_admin());

DROP POLICY IF EXISTS "Admins manage ai image api base urls" ON public.ai_image_api_base_urls;
CREATE POLICY "Admins manage ai image api base urls"
    ON public.ai_image_api_base_urls
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users view own ai image tasks" ON public.ai_image_tasks;
CREATE POLICY "Users view own ai image tasks"
    ON public.ai_image_tasks
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Admins manage ai image tasks" ON public.ai_image_tasks;
CREATE POLICY "Admins manage ai image tasks"
    ON public.ai_image_tasks
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users view own ai image results" ON public.ai_image_results;
CREATE POLICY "Users view own ai image results"
    ON public.ai_image_results
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Admins manage ai image results" ON public.ai_image_results;
CREATE POLICY "Admins manage ai image results"
    ON public.ai_image_results
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users view own ai image api usage" ON public.ai_image_api_usage;
CREATE POLICY "Users view own ai image api usage"
    ON public.ai_image_api_usage
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Admins manage ai image api usage" ON public.ai_image_api_usage;
CREATE POLICY "Admins manage ai image api usage"
    ON public.ai_image_api_usage
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users view own ai image download events" ON public.ai_image_download_events;
CREATE POLICY "Users view own ai image download events"
    ON public.ai_image_download_events
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Admins manage ai image download events" ON public.ai_image_download_events;
CREATE POLICY "Admins manage ai image download events"
    ON public.ai_image_download_events
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

INSERT INTO public.ai_image_api_base_urls (site, label, base_url, display_order, metadata)
VALUES
    ('cn', 'FatherKey Sub2API', 'https://sub2api.fatherkey.com/v1', 10, '{"source":"default"}'::jsonb),
    ('intl', 'Zaoyoe Sub2API', 'https://sub2api.zaoyoe.xyz/v1', 20, '{"source":"default"}'::jsonb)
ON CONFLICT DO NOTHING;
