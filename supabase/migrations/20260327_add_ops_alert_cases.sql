CREATE TABLE IF NOT EXISTS public.ops_alert_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_key TEXT NOT NULL,
    target_id TEXT NOT NULL,
    alert_type TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'resolved')),
    owner_admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    owner_label TEXT,
    note TEXT,
    resolution TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_action TEXT NOT NULL DEFAULT 'opened',
    last_action_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    last_action_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (category_key, target_id)
);

ALTER TABLE public.ops_alert_cases ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ops_alert_cases_status
    ON public.ops_alert_cases(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_alert_cases_category_status
    ON public.ops_alert_cases(category_key, status, updated_at DESC);

DROP POLICY IF EXISTS "Admins view all ops alert cases" ON public.ops_alert_cases;
CREATE POLICY "Admins view all ops alert cases"
    ON public.ops_alert_cases
    FOR SELECT TO authenticated
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admins insert ops alert cases" ON public.ops_alert_cases;
CREATE POLICY "Admins insert ops alert cases"
    ON public.ops_alert_cases
    FOR INSERT TO authenticated
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins update ops alert cases" ON public.ops_alert_cases;
CREATE POLICY "Admins update ops alert cases"
    ON public.ops_alert_cases
    FOR UPDATE TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.touch_ops_alert_cases_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_ops_alert_cases_updated_at ON public.ops_alert_cases;
CREATE TRIGGER trg_touch_ops_alert_cases_updated_at
    BEFORE UPDATE ON public.ops_alert_cases
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_ops_alert_cases_updated_at();

INSERT INTO public.ops_alert_cases (
    category_key,
    target_id,
    alert_type,
    status,
    owner_admin_id,
    owner_label,
    note,
    resolution,
    metadata,
    last_action,
    last_action_by,
    last_action_at,
    created_at,
    updated_at
)
SELECT
    'shop_risk' AS category_key,
    target_id,
    NULLIF(BTRIM(metadata->>'alert_type'), '') AS alert_type,
    status,
    owner_admin_id,
    owner_label,
    note,
    resolution,
    COALESCE(metadata, '{}'::jsonb),
    last_action,
    last_action_by,
    last_action_at,
    created_at,
    updated_at
FROM public.shop_risk_cases
ON CONFLICT (category_key, target_id) DO UPDATE
SET
    alert_type = COALESCE(EXCLUDED.alert_type, public.ops_alert_cases.alert_type),
    status = EXCLUDED.status,
    owner_admin_id = EXCLUDED.owner_admin_id,
    owner_label = EXCLUDED.owner_label,
    note = EXCLUDED.note,
    resolution = EXCLUDED.resolution,
    metadata = CASE
        WHEN public.ops_alert_cases.metadata = '{}'::jsonb THEN EXCLUDED.metadata
        ELSE public.ops_alert_cases.metadata || EXCLUDED.metadata
    END,
    last_action = EXCLUDED.last_action,
    last_action_by = EXCLUDED.last_action_by,
    last_action_at = EXCLUDED.last_action_at,
    updated_at = GREATEST(public.ops_alert_cases.updated_at, EXCLUDED.updated_at);

COMMENT ON TABLE public.ops_alert_cases IS 'Unified case records for centralized external ops alert handling';
