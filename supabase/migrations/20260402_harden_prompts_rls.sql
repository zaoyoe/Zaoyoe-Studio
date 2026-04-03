-- ============================================
-- Harden prompts table RLS to service-role-only writes
-- ============================================

ALTER TABLE public.prompts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated insert" ON public.prompts;
DROP POLICY IF EXISTS "Authenticated update" ON public.prompts;
DROP POLICY IF EXISTS "Service role can manage prompts." ON public.prompts;

CREATE POLICY "Service role can manage prompts."
    ON public.prompts
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
