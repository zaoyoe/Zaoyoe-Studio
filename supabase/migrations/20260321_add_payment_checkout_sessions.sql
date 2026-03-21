CREATE TABLE IF NOT EXISTS public.payment_checkout_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_key TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    site VARCHAR(10) NOT NULL DEFAULT 'cn',
    package_id UUID REFERENCES public.points_packages(id) ON DELETE SET NULL,
    package_name TEXT,
    requested_points NUMERIC(12,1) NOT NULL DEFAULT 0,
    bonus_points NUMERIC(12,1) NOT NULL DEFAULT 0,
    granted_points NUMERIC(12,1) NOT NULL DEFAULT 0,
    expected_amount NUMERIC(10,2),
    status VARCHAR(30) NOT NULL DEFAULT 'created'
        CHECK (status IN ('created', 'redirect_ready', 'completed', 'failed', 'expired', 'cancelled')),
    checkout_url TEXT,
    query_mode TEXT,
    payment_order_id UUID REFERENCES public.payment_orders(id) ON DELETE SET NULL,
    request_payload JSONB DEFAULT '{}'::JSONB,
    provider_metadata JSONB DEFAULT '{}'::JSONB,
    error_message TEXT,
    expires_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE IF EXISTS public.payment_checkout_sessions
    ADD COLUMN IF NOT EXISTS session_key TEXT,
    ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'afdian',
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) NOT NULL DEFAULT 'cn',
    ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES public.points_packages(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS package_name TEXT,
    ADD COLUMN IF NOT EXISTS requested_points NUMERIC(12,1) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS bonus_points NUMERIC(12,1) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS granted_points NUMERIC(12,1) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS expected_amount NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'created',
    ADD COLUMN IF NOT EXISTS checkout_url TEXT,
    ADD COLUMN IF NOT EXISTS query_mode TEXT,
    ADD COLUMN IF NOT EXISTS payment_order_id UUID REFERENCES public.payment_orders(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS request_payload JSONB DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS provider_metadata JSONB DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS error_message TEXT,
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_checkout_sessions_session_key
    ON public.payment_checkout_sessions(session_key);
CREATE INDEX IF NOT EXISTS idx_payment_checkout_sessions_user_id
    ON public.payment_checkout_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_checkout_sessions_provider_status
    ON public.payment_checkout_sessions(provider, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_checkout_sessions_payment_order_id
    ON public.payment_checkout_sessions(payment_order_id);

ALTER TABLE public.payment_checkout_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own payment checkout sessions" ON public.payment_checkout_sessions;
DROP POLICY IF EXISTS "Admins view all payment checkout sessions" ON public.payment_checkout_sessions;

CREATE POLICY "Users view own payment checkout sessions"
    ON public.payment_checkout_sessions
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "Admins view all payment checkout sessions"
    ON public.payment_checkout_sessions
    FOR SELECT TO authenticated
    USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.touch_payment_checkout_sessions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_payment_checkout_sessions_updated_at ON public.payment_checkout_sessions;
CREATE TRIGGER trg_touch_payment_checkout_sessions_updated_at
    BEFORE UPDATE ON public.payment_checkout_sessions
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_payment_checkout_sessions_updated_at();
