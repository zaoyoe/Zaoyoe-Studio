CREATE TABLE IF NOT EXISTS public.payment_anomaly_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type TEXT NOT NULL CHECK (target_type IN ('order', 'event', 'session')),
    target_id UUID NOT NULL,
    target_provider TEXT,
    target_provider_order_no TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'handled', 'ignored', 'retry_requested', 'approved', 'rejected')),
    note TEXT,
    resolution TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_action TEXT NOT NULL DEFAULT 'opened',
    last_action_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    last_action_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (target_type, target_id)
);

ALTER TABLE public.payment_anomaly_cases ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_payment_anomaly_cases_status
    ON public.payment_anomaly_cases(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_anomaly_cases_provider
    ON public.payment_anomaly_cases(target_provider, status, created_at DESC);

DROP POLICY IF EXISTS "Admins view all payment anomaly cases" ON public.payment_anomaly_cases;
CREATE POLICY "Admins view all payment anomaly cases"
    ON public.payment_anomaly_cases
    FOR SELECT TO authenticated
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admins insert payment anomaly cases" ON public.payment_anomaly_cases;
CREATE POLICY "Admins insert payment anomaly cases"
    ON public.payment_anomaly_cases
    FOR INSERT TO authenticated
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins update payment anomaly cases" ON public.payment_anomaly_cases;
CREATE POLICY "Admins update payment anomaly cases"
    ON public.payment_anomaly_cases
    FOR UPDATE TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.touch_payment_anomaly_cases_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_payment_anomaly_cases_updated_at ON public.payment_anomaly_cases;
CREATE TRIGGER trg_touch_payment_anomaly_cases_updated_at
    BEFORE UPDATE ON public.payment_anomaly_cases
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_payment_anomaly_cases_updated_at();
