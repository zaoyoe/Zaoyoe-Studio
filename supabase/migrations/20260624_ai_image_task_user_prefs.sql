-- Per-user AI image task list preferences.
-- These rows store view-level choices such as hidden, pinned, and accent color
-- without mutating the underlying generation task or billing records.

CREATE TABLE IF NOT EXISTS public.ai_image_task_user_prefs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site TEXT NOT NULL DEFAULT 'cn'
        CHECK (site IN ('cn', 'intl')),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES public.ai_image_tasks(id) ON DELETE CASCADE,
    hidden_at TIMESTAMPTZ,
    pinned_at TIMESTAMPTZ,
    accent TEXT
        CHECK (accent IS NULL OR accent IN ('blue', 'green', 'gold', 'rose')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_image_task_user_prefs_unique UNIQUE (user_id, site, task_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_image_task_user_prefs_user_site_pinned
    ON public.ai_image_task_user_prefs (user_id, site, pinned_at DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_image_task_user_prefs_user_site_hidden
    ON public.ai_image_task_user_prefs (user_id, site, hidden_at)
    WHERE hidden_at IS NOT NULL;

DROP TRIGGER IF EXISTS trg_ai_image_task_user_prefs_touch_updated_at
    ON public.ai_image_task_user_prefs;
CREATE TRIGGER trg_ai_image_task_user_prefs_touch_updated_at
BEFORE INSERT OR UPDATE ON public.ai_image_task_user_prefs
FOR EACH ROW
EXECUTE FUNCTION public.fn_touch_ai_image_updated_at();

ALTER TABLE public.ai_image_task_user_prefs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.ai_image_task_user_prefs
    TO authenticated, service_role;

DROP POLICY IF EXISTS "Users view own ai image task prefs" ON public.ai_image_task_user_prefs;
CREATE POLICY "Users view own ai image task prefs"
    ON public.ai_image_task_user_prefs
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users create own ai image task prefs" ON public.ai_image_task_user_prefs;
CREATE POLICY "Users create own ai image task prefs"
    ON public.ai_image_task_user_prefs
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users update own ai image task prefs" ON public.ai_image_task_user_prefs;
CREATE POLICY "Users update own ai image task prefs"
    ON public.ai_image_task_user_prefs
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id OR public.is_admin())
    WITH CHECK (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Users delete own ai image task prefs" ON public.ai_image_task_user_prefs;
CREATE POLICY "Users delete own ai image task prefs"
    ON public.ai_image_task_user_prefs
    FOR DELETE TO authenticated
    USING (auth.uid() = user_id OR public.is_admin());
