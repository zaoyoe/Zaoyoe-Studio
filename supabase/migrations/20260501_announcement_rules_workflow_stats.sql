BEGIN;

CREATE TABLE IF NOT EXISTS public.announcement_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL DEFAULT '未命名公告',
    content TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'banner',
    color TEXT NOT NULL DEFAULT 'purple',
    size TEXT NOT NULL DEFAULT 'medium',
    decoration TEXT NOT NULL DEFAULT 'none',
    pages TEXT[] NOT NULL DEFAULT ARRAY['all']::TEXT[],
    page_overrides JSONB NOT NULL DEFAULT '{}'::JSONB,
    enabled BOOLEAN NOT NULL DEFAULT false,
    priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    submitted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    submitted_at TIMESTAMPTZ,
    approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    rejected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    rejected_at TIMESTAMPTZ,
    rejection_reason TEXT,
    archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    archived_at TIMESTAMPTZ,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT announcement_rules_type_check CHECK (type IN ('banner', 'modal', 'toast')),
    CONSTRAINT announcement_rules_size_check CHECK (size IN ('small', 'medium', 'large')),
    CONSTRAINT announcement_rules_status_check CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected', 'archived')),
    CONSTRAINT announcement_rules_priority_check CHECK (priority BETWEEN -1000 AND 1000),
    CONSTRAINT announcement_rules_schedule_check CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);

CREATE INDEX IF NOT EXISTS idx_announcement_rules_public_lookup
    ON public.announcement_rules (enabled, status, priority DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_announcement_rules_schedule
    ON public.announcement_rules (starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_announcement_rules_pages_gin
    ON public.announcement_rules USING GIN (pages);

CREATE TABLE IF NOT EXISTS public.announcement_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID REFERENCES public.announcement_rules(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_label TEXT,
    note TEXT,
    snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_announcement_history_announcement_created
    ON public.announcement_history (announcement_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.announcement_reads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID NOT NULL REFERENCES public.announcement_rules(id) ON DELETE CASCADE,
    reader_key TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    page TEXT NOT NULL DEFAULT 'unknown',
    event_type TEXT NOT NULL DEFAULT 'read',
    ack_key TEXT,
    user_agent TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT announcement_reads_event_type_check CHECK (event_type IN ('view', 'read', 'dismiss')),
    CONSTRAINT announcement_reads_reader_key_check CHECK (length(trim(reader_key)) > 0),
    CONSTRAINT announcement_reads_unique_event UNIQUE (announcement_id, reader_key, page, event_type)
);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_announcement_event
    ON public.announcement_reads (announcement_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_page_event
    ON public.announcement_reads (page, event_type, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_announcement_rules_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_announcement_rules_updated_at ON public.announcement_rules;
CREATE TRIGGER trigger_announcement_rules_updated_at
BEFORE UPDATE ON public.announcement_rules
FOR EACH ROW
EXECUTE FUNCTION public.set_announcement_rules_updated_at();

ALTER TABLE public.announcement_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view announcement rules" ON public.announcement_rules;
CREATE POLICY "Admins can view announcement rules"
    ON public.announcement_rules FOR SELECT
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert announcement rules" ON public.announcement_rules;
CREATE POLICY "Admins can insert announcement rules"
    ON public.announcement_rules FOR INSERT
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update announcement rules" ON public.announcement_rules;
CREATE POLICY "Admins can update announcement rules"
    ON public.announcement_rules FOR UPDATE
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete announcement rules" ON public.announcement_rules;
CREATE POLICY "Admins can delete announcement rules"
    ON public.announcement_rules FOR DELETE
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can view announcement history" ON public.announcement_history;
CREATE POLICY "Admins can view announcement history"
    ON public.announcement_history FOR SELECT
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert announcement history" ON public.announcement_history;
CREATE POLICY "Admins can insert announcement history"
    ON public.announcement_history FOR INSERT
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can view announcement reads" ON public.announcement_reads;
CREATE POLICY "Admins can view announcement reads"
    ON public.announcement_reads FOR SELECT
    USING (public.is_admin());

COMMENT ON TABLE public.announcement_rules IS 'Admin Studio announcement rules with scheduling, priority, and approval workflow.';
COMMENT ON TABLE public.announcement_history IS 'Announcement workflow and edit history snapshots.';
COMMENT ON TABLE public.announcement_reads IS 'Public announcement view/read/dismiss events for statistics.';

COMMIT;
