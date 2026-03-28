CREATE TABLE IF NOT EXISTS public.ops_alert_case_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_key TEXT NOT NULL,
    target_id TEXT NOT NULL,
    alert_type TEXT,
    action TEXT NOT NULL CHECK (action IN ('claim', 'assign', 'add_note', 'resolve', 'reopen', 'batch_mute')),
    status TEXT CHECK (status IN ('open', 'claimed', 'resolved')),
    owner_admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    owner_label TEXT,
    actor_admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_label TEXT,
    note TEXT,
    resolution TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ops_alert_case_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ops_alert_case_events_target_created
    ON public.ops_alert_case_events(category_key, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_alert_case_events_action_created
    ON public.ops_alert_case_events(action, created_at DESC);

DROP POLICY IF EXISTS "Admins view all ops alert case events" ON public.ops_alert_case_events;
CREATE POLICY "Admins view all ops alert case events"
    ON public.ops_alert_case_events
    FOR SELECT TO authenticated
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admins insert ops alert case events" ON public.ops_alert_case_events;
CREATE POLICY "Admins insert ops alert case events"
    ON public.ops_alert_case_events
    FOR INSERT TO authenticated
    WITH CHECK (public.is_admin());

COMMENT ON TABLE public.ops_alert_case_events IS 'Action history for centralized ops alert handling cases';
