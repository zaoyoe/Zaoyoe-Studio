-- Customer Engagement Hub: user activity heartbeat for inactive-user targeting.

CREATE TABLE IF NOT EXISTS public.engagement_user_activity (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_page_id TEXT,
    site TEXT DEFAULT 'cn',
    source_module TEXT DEFAULT 'engagement.feed',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_engagement_user_activity_last_active
    ON public.engagement_user_activity (last_active_at DESC);

CREATE INDEX IF NOT EXISTS idx_engagement_user_activity_site_page
    ON public.engagement_user_activity (site, last_page_id, last_active_at DESC);

ALTER TABLE public.engagement_user_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view engagement user activity" ON public.engagement_user_activity;
CREATE POLICY "Admins can view engagement user activity"
    ON public.engagement_user_activity FOR SELECT
    USING (public.is_admin());

DROP POLICY IF EXISTS "Users can view own engagement activity" ON public.engagement_user_activity;
CREATE POLICY "Users can view own engagement activity"
    ON public.engagement_user_activity FOR SELECT
    USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_engagement_user_activity_updated_at ON public.engagement_user_activity;
CREATE OR REPLACE FUNCTION public.touch_engagement_user_activity_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_engagement_user_activity_updated_at
    BEFORE UPDATE ON public.engagement_user_activity
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_engagement_user_activity_updated_at();

COMMENT ON TABLE public.engagement_user_activity IS 'Latest public-page robot heartbeat per user, used for inactive_user engagement targeting.';
