CREATE TABLE IF NOT EXISTS public.shop_risk_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_id TEXT NOT NULL UNIQUE,
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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.shop_risk_cases ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_shop_risk_cases_status
    ON public.shop_risk_cases(status, updated_at DESC);

DROP POLICY IF EXISTS "Admins view all shop risk cases" ON public.shop_risk_cases;
CREATE POLICY "Admins view all shop risk cases"
    ON public.shop_risk_cases
    FOR SELECT TO authenticated
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admins insert shop risk cases" ON public.shop_risk_cases;
CREATE POLICY "Admins insert shop risk cases"
    ON public.shop_risk_cases
    FOR INSERT TO authenticated
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins update shop risk cases" ON public.shop_risk_cases;
CREATE POLICY "Admins update shop risk cases"
    ON public.shop_risk_cases
    FOR UPDATE TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.touch_shop_risk_cases_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_shop_risk_cases_updated_at ON public.shop_risk_cases;
CREATE TRIGGER trg_touch_shop_risk_cases_updated_at
    BEFORE UPDATE ON public.shop_risk_cases
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_shop_risk_cases_updated_at();
