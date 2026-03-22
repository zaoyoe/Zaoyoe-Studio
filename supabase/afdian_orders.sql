-- ============================================
-- Afdian / Payment Orders
-- ============================================

ALTER TABLE IF EXISTS public.redemption_codes
    ADD COLUMN IF NOT EXISTS points_amount INTEGER;

ALTER TABLE IF EXISTS public.redemption_codes
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn';

CREATE TABLE IF NOT EXISTS public.payment_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    provider_order_no TEXT NOT NULL,
    provider_user_id TEXT,
    plan_id TEXT,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    site VARCHAR(10) NOT NULL DEFAULT 'cn',
    package_id UUID REFERENCES public.points_packages(id) ON DELETE SET NULL,
    package_name TEXT,
    checkout_session_id UUID,
    expected_amount NUMERIC(10,2),
    paid_amount NUMERIC(10,2),
    points_amount INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'redeemed', 'amount_mismatch', 'rejected', 'pending_review', 'expired', 'refunded')),
    sign_verified BOOLEAN NOT NULL DEFAULT false,
    amount_verified BOOLEAN NOT NULL DEFAULT false,
    raw_payload JSONB DEFAULT '{}'::JSONB,
    provider_metadata JSONB DEFAULT '{}'::JSONB,
    redemption_code TEXT,
    paid_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_error TEXT,
    CONSTRAINT payment_orders_provider_order_unique UNIQUE (provider, provider_order_no)
);

ALTER TABLE IF EXISTS public.payment_orders
    ADD COLUMN IF NOT EXISTS provider_user_id TEXT,
    ADD COLUMN IF NOT EXISTS plan_id TEXT,
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) NOT NULL DEFAULT 'cn',
    ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES public.points_packages(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS package_name TEXT,
    ADD COLUMN IF NOT EXISTS checkout_session_id UUID,
    ADD COLUMN IF NOT EXISTS expected_amount NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS points_amount INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS sign_verified BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS amount_verified BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS raw_payload JSONB DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS provider_metadata JSONB DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS redemption_code TEXT,
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_payment_orders_provider_created_at
    ON public.payment_orders(provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_user_id
    ON public.payment_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status
    ON public.payment_orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_site_status
    ON public.payment_orders(site, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_checkout_session_id_unique
    ON public.payment_orders(checkout_session_id)
    WHERE checkout_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_orders_checkout_session_created_at
    ON public.payment_orders(checkout_session_id, created_at DESC)
    WHERE checkout_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.payment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_order_id UUID REFERENCES public.payment_orders(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    provider_order_no TEXT,
    event_key TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    signature_valid BOOLEAN NOT NULL DEFAULT false,
    amount_valid BOOLEAN,
    processing_result TEXT,
    payload JSONB DEFAULT '{}'::JSONB,
    error_message TEXT,
    response_status INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

ALTER TABLE IF EXISTS public.payment_events
    ADD COLUMN IF NOT EXISTS payment_order_id UUID REFERENCES public.payment_orders(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'afdian',
    ADD COLUMN IF NOT EXISTS provider_order_no TEXT,
    ADD COLUMN IF NOT EXISTS event_key TEXT,
    ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'webhook',
    ADD COLUMN IF NOT EXISTS signature_valid BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS amount_valid BOOLEAN,
    ADD COLUMN IF NOT EXISTS processing_result TEXT,
    ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS error_message TEXT,
    ADD COLUMN IF NOT EXISTS response_status INTEGER,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_event_key
    ON public.payment_events(event_key);
CREATE INDEX IF NOT EXISTS idx_payment_events_provider_created_at
    ON public.payment_events(provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_events_provider_response_status
    ON public.payment_events(provider, response_status, created_at DESC);

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

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'payment_orders_checkout_session_id_fkey'
          AND conrelid = 'public.payment_orders'::regclass
    ) THEN
        ALTER TABLE public.payment_orders
            ADD CONSTRAINT payment_orders_checkout_session_id_fkey
            FOREIGN KEY (checkout_session_id)
            REFERENCES public.payment_checkout_sessions(id)
            ON DELETE SET NULL;
    END IF;
END;
$$;

UPDATE public.payment_orders po
SET checkout_session_id = pcs.id
FROM public.payment_checkout_sessions pcs
WHERE po.checkout_session_id IS NULL
  AND (
      pcs.payment_order_id = po.id
      OR (
          jsonb_typeof(COALESCE(po.provider_metadata, '{}'::JSONB)) = 'object'
          AND COALESCE(po.provider_metadata->>'checkout_session_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND (po.provider_metadata->>'checkout_session_id')::UUID = pcs.id
      )
  );

CREATE TABLE IF NOT EXISTS public.afdian_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    out_trade_no TEXT UNIQUE NOT NULL,
    afdian_user_id TEXT,
    plan_id TEXT,
    total_amount NUMERIC(10,2) NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    redeem_code TEXT,
    is_redeemed BOOLEAN DEFAULT false,
    remark TEXT,
    raw_payload JSONB,
    site VARCHAR(10) NOT NULL DEFAULT 'cn',
    site_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    claimed_at TIMESTAMPTZ,
    payment_status VARCHAR(30) NOT NULL DEFAULT 'pending_review',
    sign_verified BOOLEAN NOT NULL DEFAULT false,
    amount_verified BOOLEAN NOT NULL DEFAULT false,
    paid_at TIMESTAMPTZ,
    verified_at TIMESTAMPTZ,
    redeemed_at TIMESTAMPTZ,
    payment_order_id UUID REFERENCES public.payment_orders(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE IF EXISTS public.afdian_orders
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) NOT NULL DEFAULT 'cn',
    ADD COLUMN IF NOT EXISTS site_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30) NOT NULL DEFAULT 'pending_review',
    ADD COLUMN IF NOT EXISTS sign_verified BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS amount_verified BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS redeemed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS payment_order_id UUID REFERENCES public.payment_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_afdian_orders_trade_no
    ON public.afdian_orders(out_trade_no);
CREATE INDEX IF NOT EXISTS idx_afdian_orders_code
    ON public.afdian_orders(redeem_code);
CREATE INDEX IF NOT EXISTS idx_afdian_orders_site_user
    ON public.afdian_orders(site_user_id, created_at DESC);

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_checkout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.afdian_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own payment orders" ON public.payment_orders;
DROP POLICY IF EXISTS "Admins view all payment orders" ON public.payment_orders;
DROP POLICY IF EXISTS "Admins view payment events" ON public.payment_events;
DROP POLICY IF EXISTS "Users view own payment checkout sessions" ON public.payment_checkout_sessions;
DROP POLICY IF EXISTS "Admins view all payment checkout sessions" ON public.payment_checkout_sessions;
DROP POLICY IF EXISTS "Users view own afdian orders" ON public.afdian_orders;
DROP POLICY IF EXISTS "Admins view all afdian orders" ON public.afdian_orders;
DROP POLICY IF EXISTS "Anyone can query code by order number" ON public.afdian_orders;

CREATE POLICY "Users view own payment orders"
    ON public.payment_orders
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "Admins view all payment orders"
    ON public.payment_orders
    FOR SELECT TO authenticated
    USING (public.is_admin());

CREATE POLICY "Admins view payment events"
    ON public.payment_events
    FOR SELECT TO authenticated
    USING (public.is_admin());

CREATE POLICY "Users view own payment checkout sessions"
    ON public.payment_checkout_sessions
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "Admins view all payment checkout sessions"
    ON public.payment_checkout_sessions
    FOR SELECT TO authenticated
    USING (public.is_admin());

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

CREATE TABLE IF NOT EXISTS public.payment_query_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    site VARCHAR(10) NOT NULL DEFAULT 'cn',
    order_no TEXT,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    payment_order_id UUID REFERENCES public.payment_orders(id) ON DELETE SET NULL,
    checkout_session_id UUID REFERENCES public.payment_checkout_sessions(id) ON DELETE SET NULL,
    success BOOLEAN NOT NULL DEFAULT false,
    response_status INTEGER,
    outcome_code TEXT NOT NULL,
    message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.payment_anomaly_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_query_attempts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_payment_anomaly_cases_status
    ON public.payment_anomaly_cases(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_anomaly_cases_provider
    ON public.payment_anomaly_cases(target_provider, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_query_attempts_provider_created
    ON public.payment_query_attempts(provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_query_attempts_provider_success_created
    ON public.payment_query_attempts(provider, success, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_query_attempts_site_created
    ON public.payment_query_attempts(site, created_at DESC);

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

DROP POLICY IF EXISTS "Admins view payment query attempts" ON public.payment_query_attempts;
CREATE POLICY "Admins view payment query attempts"
    ON public.payment_query_attempts
    FOR SELECT TO authenticated
    USING (public.is_admin());

DROP POLICY IF EXISTS "Service role inserts payment query attempts" ON public.payment_query_attempts;
CREATE POLICY "Service role inserts payment query attempts"
    ON public.payment_query_attempts
    FOR INSERT TO authenticated
    WITH CHECK (public.is_admin());

CREATE POLICY "Users view own afdian orders"
    ON public.afdian_orders
    FOR SELECT TO authenticated
    USING (site_user_id = auth.uid());

CREATE POLICY "Admins view all afdian orders"
    ON public.afdian_orders
    FOR SELECT TO authenticated
    USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.touch_payment_orders_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_payment_orders_updated_at ON public.payment_orders;
CREATE TRIGGER trg_touch_payment_orders_updated_at
    BEFORE UPDATE ON public.payment_orders
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_payment_orders_updated_at();

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

CREATE OR REPLACE FUNCTION public.generate_redemption_code()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_code TEXT;
BEGIN
    LOOP
        v_code := 'ZY-'
            || upper(substring(md5(random()::text) from 1 for 4))
            || '-'
            || upper(substring(md5(random()::text) from 1 for 4))
            || '-'
            || upper(substring(md5(random()::text) from 1 for 4));

        EXIT WHEN NOT EXISTS (
            SELECT 1
            FROM public.redemption_codes
            WHERE code = v_code
        );
    END LOOP;

    RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_ensure_redemption_code_for_payment_order(
    p_payment_order_id UUID,
    p_package_id UUID DEFAULT NULL,
    p_points INTEGER DEFAULT 0,
    p_site VARCHAR DEFAULT 'cn',
    p_external_order_id TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_payment_order public.payment_orders%ROWTYPE;
    v_effective_code TEXT;
BEGIN
    IF p_payment_order_id IS NULL THEN
        RAISE EXCEPTION 'payment_order_id is required';
    END IF;

    SELECT *
    INTO v_payment_order
    FROM public.payment_orders
    WHERE id = p_payment_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'payment order not found';
    END IF;

    IF GREATEST(COALESCE(p_points, 0), COALESCE(v_payment_order.points_amount, 0), 0) <= 0 THEN
        RAISE EXCEPTION 'payment order points must be greater than 0 before issuing redemption code';
    END IF;

    v_effective_code := NULLIF(BTRIM(v_payment_order.redemption_code), '');

    IF COALESCE(v_effective_code, '') = '' THEN
        FOR i IN 1..8 LOOP
            BEGIN
                v_effective_code := public.generate_redemption_code();

                INSERT INTO public.redemption_codes (
                    code,
                    package_id,
                    points_amount,
                    status,
                    site,
                    external_order_id
                ) VALUES (
                    v_effective_code,
                    COALESCE(p_package_id, v_payment_order.package_id),
                    GREATEST(COALESCE(p_points, 0), COALESCE(v_payment_order.points_amount, 0), 0),
                    'pending',
                    COALESCE(NULLIF(BTRIM(p_site), ''), v_payment_order.site, 'cn'),
                    COALESCE(NULLIF(BTRIM(p_external_order_id), ''), NULLIF(BTRIM(v_payment_order.provider_order_no), ''), v_payment_order.id::TEXT)
                );

                EXIT;
            EXCEPTION WHEN unique_violation THEN
                v_effective_code := NULL;
            END;
        END LOOP;

        IF COALESCE(v_effective_code, '') = '' THEN
            RAISE EXCEPTION 'failed to generate redemption code';
        END IF;
    END IF;

    INSERT INTO public.redemption_codes (
        code,
        package_id,
        points_amount,
        status,
        site,
        external_order_id
    ) VALUES (
        v_effective_code,
        COALESCE(p_package_id, v_payment_order.package_id),
        GREATEST(COALESCE(p_points, 0), COALESCE(v_payment_order.points_amount, 0), 0),
        'pending',
        COALESCE(NULLIF(BTRIM(p_site), ''), v_payment_order.site, 'cn'),
        COALESCE(NULLIF(BTRIM(p_external_order_id), ''), NULLIF(BTRIM(v_payment_order.provider_order_no), ''), v_payment_order.id::TEXT)
    )
    ON CONFLICT (code) DO UPDATE SET
        package_id = COALESCE(redemption_codes.package_id, EXCLUDED.package_id),
        points_amount = COALESCE(redemption_codes.points_amount, EXCLUDED.points_amount),
        site = COALESCE(redemption_codes.site, EXCLUDED.site),
        external_order_id = COALESCE(redemption_codes.external_order_id, EXCLUDED.external_order_id);

    UPDATE public.payment_orders
    SET
        redemption_code = v_effective_code,
        updated_at = NOW()
    WHERE id = p_payment_order_id;

    RETURN v_effective_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_ensure_redemption_code_for_payment_order(
    UUID,
    UUID,
    INTEGER,
    VARCHAR,
    TEXT
) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.fn_apply_payment_order_review(UUID, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.fn_apply_payment_order_review(
    p_payment_order_id UUID,
    p_action TEXT,
    p_note TEXT DEFAULT NULL,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order public.payment_orders%ROWTYPE;
    v_action TEXT := COALESCE(NULLIF(BTRIM(LOWER(p_action)), ''), '');
    v_note TEXT := NULLIF(BTRIM(p_note), '');
    v_now TIMESTAMPTZ := NOW();
    v_next_status TEXT;
    v_redemption_code TEXT;
    v_manual_review JSONB;
BEGIN
    IF p_payment_order_id IS NULL THEN
        RAISE EXCEPTION 'payment_order_id is required';
    END IF;

    IF v_action NOT IN ('approve', 'reject') THEN
        RAISE EXCEPTION 'unsupported review action';
    END IF;

    SELECT *
    INTO v_order
    FROM public.payment_orders
    WHERE id = p_payment_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'payment order not found';
    END IF;

    IF COALESCE(NULLIF(BTRIM(LOWER(v_order.status)), ''), '') NOT IN ('pending_review', 'amount_mismatch') THEN
        RAISE EXCEPTION 'only pending_review or amount_mismatch orders can be reviewed';
    END IF;

    v_next_status := CASE WHEN v_action = 'approve' THEN 'paid' ELSE 'rejected' END;

    IF v_action = 'approve'
       AND COALESCE(NULLIF(BTRIM(LOWER(v_order.provider)), ''), '') = 'afdian'
       AND GREATEST(COALESCE(v_order.points_amount, 0), 0) <= 0
       AND COALESCE(NULLIF(BTRIM(v_order.redemption_code), ''), '') = ''
    THEN
        RAISE EXCEPTION 'afdian order has no valid package/points, cannot approve safely';
    END IF;

    IF v_action = 'approve'
       AND COALESCE(NULLIF(BTRIM(LOWER(v_order.provider)), ''), '') = 'afdian'
    THEN
        v_redemption_code := public.fn_ensure_redemption_code_for_payment_order(
            v_order.id,
            v_order.package_id,
            v_order.points_amount,
            v_order.site,
            v_order.provider_order_no
        );
    ELSE
        v_redemption_code := v_order.redemption_code;
    END IF;

    v_manual_review := jsonb_strip_nulls(jsonb_build_object(
        'action', v_action,
        'previous_status', v_order.status,
        'reviewed_at', v_now,
        'reviewed_by', p_actor_id,
        'note', v_note,
        'amount_override', (v_order.status = 'amount_mismatch' AND v_action = 'approve')
    ));

    UPDATE public.payment_orders
    SET
        status = v_next_status,
        paid_at = CASE
            WHEN v_action = 'approve' THEN COALESCE(v_order.paid_at, v_now)
            ELSE v_order.paid_at
        END,
        verified_at = CASE
            WHEN v_action = 'approve' THEN v_now
            ELSE COALESCE(v_order.verified_at, v_now)
        END,
        redemption_code = COALESCE(v_redemption_code, v_order.redemption_code),
        last_error = CASE
            WHEN v_action = 'approve' THEN NULL
            ELSE COALESCE(v_note, '已人工审核驳回')
        END,
        provider_metadata = COALESCE(v_order.provider_metadata, '{}'::JSONB) || jsonb_build_object(
            'manual_review', v_manual_review,
            'provider_order_resolved', TRUE,
            'provider_order_resolved_at', COALESCE(
                COALESCE(v_order.provider_metadata, '{}'::JSONB)->'provider_order_resolved_at',
                to_jsonb(v_now)
            )
        ),
        updated_at = v_now
    WHERE id = v_order.id;

    IF v_order.checkout_session_id IS NOT NULL THEN
        UPDATE public.payment_checkout_sessions
        SET
            payment_order_id = v_order.id,
            status = CASE
                WHEN v_action = 'approve' THEN 'completed'
                ELSE 'failed'
            END,
            completed_at = CASE
                WHEN v_action = 'approve' THEN COALESCE(completed_at, v_now)
                ELSE completed_at
            END,
            error_message = CASE
                WHEN v_action = 'approve' THEN NULL
                ELSE COALESCE(v_note, '已人工审核驳回')
            END,
            provider_metadata = COALESCE(provider_metadata, '{}'::JSONB) || jsonb_strip_nulls(jsonb_build_object(
                'linked_by', 'manual_review',
                'linked_at', v_now,
                'payment_status', v_next_status,
                'provider_order_no', v_order.provider_order_no
            )),
            updated_at = v_now
        WHERE id = v_order.checkout_session_id;
    END IF;

    IF COALESCE(NULLIF(BTRIM(LOWER(v_order.provider)), ''), '') = 'afdian' THEN
        UPDATE public.afdian_orders
        SET
            payment_status = v_next_status,
            redeem_code = COALESCE(v_redemption_code, redeem_code),
            sign_verified = COALESCE(sign_verified, false) OR COALESCE(v_order.sign_verified, false),
            amount_verified = COALESCE(amount_verified, false) OR COALESCE(v_order.amount_verified, false),
            paid_at = CASE
                WHEN v_action = 'approve' THEN COALESCE(paid_at, v_order.paid_at, v_now)
                ELSE paid_at
            END,
            verified_at = CASE
                WHEN v_action = 'approve' THEN COALESCE(verified_at, v_now)
                ELSE verified_at
            END,
            payment_order_id = v_order.id
        WHERE out_trade_no = v_order.provider_order_no
           OR payment_order_id = v_order.id;
    END IF;

    RETURN jsonb_build_object(
        'payment_order_id', v_order.id,
        'status', v_next_status,
        'redemption_code', COALESCE(v_redemption_code, v_order.redemption_code),
        'checkout_session_id', v_order.checkout_session_id,
        'reviewed_at', v_now
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_apply_payment_order_review(UUID, TEXT, TEXT, UUID)
    TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_afdian_redemption_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NEW.code IS NULL THEN
        RETURN NEW;
    END IF;

    UPDATE public.afdian_orders
    SET
        is_redeemed = (NEW.status = 'used'),
        redeemed_at = CASE
            WHEN NEW.status = 'used' THEN COALESCE(NEW.used_at, NOW())
            ELSE redeemed_at
        END
    WHERE redeem_code = NEW.code;

    UPDATE public.payment_orders
    SET
        status = CASE
            WHEN NEW.status = 'used' THEN 'redeemed'
            ELSE status
        END,
        updated_at = NOW()
    WHERE provider = 'afdian'
      AND redemption_code = NEW.code;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_afdian_redemption_status ON public.redemption_codes;
CREATE TRIGGER trg_sync_afdian_redemption_status
    AFTER INSERT OR UPDATE OF status, used_at
    ON public.redemption_codes
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_afdian_redemption_status();

DROP FUNCTION IF EXISTS public.fn_process_afdian_payment(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, UUID, TEXT, VARCHAR, BOOLEAN, BOOLEAN, JSONB, TEXT);
DROP FUNCTION IF EXISTS public.fn_process_afdian_payment(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, UUID, TEXT, VARCHAR, BOOLEAN, BOOLEAN, JSONB, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.fn_process_afdian_payment(
    p_order_no TEXT,
    p_afdian_user_id TEXT,
    p_plan_id TEXT,
    p_paid_amount NUMERIC,
    p_expected_amount NUMERIC,
    p_points INTEGER,
    p_package_id UUID DEFAULT NULL,
    p_package_name TEXT DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn',
    p_signature_valid BOOLEAN DEFAULT false,
    p_amount_valid BOOLEAN DEFAULT false,
    p_payload JSONB DEFAULT '{}'::JSONB,
    p_error TEXT DEFAULT NULL,
    p_payment_order_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_payment_order_id UUID;
    v_existing_code TEXT;
    v_effective_code TEXT;
    v_status VARCHAR(30);
    v_now TIMESTAMPTZ := NOW();
    v_existing_order public.payment_orders%ROWTYPE;
    v_existing_provider_order_id UUID;
    v_existing_metadata JSONB := '{}'::JSONB;
    v_existing_raw_payload JSONB := '{}'::JSONB;
    v_targeted_update_applied BOOLEAN := FALSE;
BEGIN
    IF COALESCE(BTRIM(p_order_no), '') = '' THEN
        RAISE EXCEPTION 'order_no is required';
    END IF;

    p_site := COALESCE(NULLIF(BTRIM(p_site), ''), 'cn');
    v_status := CASE
        WHEN NOT COALESCE(p_signature_valid, false) THEN 'rejected'
        WHEN NOT COALESCE(p_amount_valid, false) THEN 'amount_mismatch'
        WHEN COALESCE(p_points, 0) <= 0 THEN 'pending_review'
        ELSE 'paid'
    END;

    IF p_payment_order_id IS NOT NULL THEN
        SELECT *
        INTO v_existing_order
        FROM public.payment_orders
        WHERE id = p_payment_order_id
        FOR UPDATE;

        IF FOUND AND COALESCE(NULLIF(BTRIM(LOWER(v_existing_order.provider)), ''), '') = 'afdian' THEN
            v_existing_metadata := COALESCE(v_existing_order.provider_metadata, '{}'::JSONB);
            v_existing_raw_payload := COALESCE(v_existing_order.raw_payload, '{}'::JSONB);

            SELECT id
            INTO v_existing_provider_order_id
            FROM public.payment_orders
            WHERE provider = 'afdian'
              AND provider_order_no = p_order_no
              AND id <> v_existing_order.id
            LIMIT 1;

            IF v_existing_provider_order_id IS NOT NULL THEN
                UPDATE public.payment_orders
                SET
                    checkout_session_id = NULL,
                    provider_metadata = v_existing_metadata || jsonb_strip_nulls(jsonb_build_object(
                        'provider_order_pending', TRUE,
                        'provider_order_resolved', FALSE,
                        'checkout_session_detached_at', v_now,
                        'checkout_session_detached_by', 'fn_process_afdian_payment_existing_order',
                        'superseded_by_payment_order_id', v_existing_provider_order_id
                    )),
                    last_error = COALESCE(NULLIF(BTRIM(last_error), ''), 'superseded_by_existing_provider_order'),
                    updated_at = v_now
                WHERE id = v_existing_order.id
                  AND v_existing_order.checkout_session_id IS NOT NULL;

                v_payment_order_id := v_existing_provider_order_id;
            ELSE
                UPDATE public.payment_orders
                SET
                    provider_order_no = p_order_no,
                    provider_user_id = COALESCE(NULLIF(BTRIM(p_afdian_user_id), ''), provider_user_id),
                    plan_id = COALESCE(NULLIF(BTRIM(p_plan_id), ''), plan_id),
                    site = COALESCE(NULLIF(BTRIM(p_site), ''), site),
                    package_id = COALESCE(p_package_id, package_id),
                    package_name = COALESCE(NULLIF(BTRIM(p_package_name), ''), package_name),
                    expected_amount = COALESCE(p_expected_amount, expected_amount),
                    paid_amount = COALESCE(p_paid_amount, paid_amount),
                    points_amount = GREATEST(COALESCE(points_amount, 0), GREATEST(COALESCE(p_points, 0), 0)),
                    sign_verified = COALESCE(sign_verified, false) OR COALESCE(p_signature_valid, false),
                    amount_verified = COALESCE(amount_verified, false) OR COALESCE(p_amount_valid, false),
                    raw_payload = v_existing_raw_payload || COALESCE(p_payload, '{}'::JSONB),
                    provider_metadata = v_existing_metadata || jsonb_strip_nulls(jsonb_build_object(
                        'plan_id', p_plan_id,
                        'package_name', p_package_name,
                        'checkout_session_id', v_existing_order.checkout_session_id,
                        'provider_order_resolved', TRUE,
                        'provider_order_resolved_at', v_now,
                        'intent_created_at', COALESCE(
                            v_existing_metadata->'intent_created_at',
                            to_jsonb(v_existing_order.created_at)
                        )
                    )),
                    paid_at = COALESCE(paid_at, CASE WHEN v_status = 'paid' THEN v_now ELSE NULL END),
                    verified_at = COALESCE(
                        verified_at,
                        CASE
                            WHEN COALESCE(p_signature_valid, false) AND COALESCE(p_amount_valid, false)
                                THEN v_now
                            ELSE NULL
                        END
                    ),
                    last_error = CASE
                        WHEN v_status = 'paid' THEN NULL
                        ELSE NULLIF(BTRIM(COALESCE(p_error, '')), '')
                    END,
                    status = CASE
                        WHEN status = 'redeemed' THEN status
                        WHEN v_status = 'paid' THEN 'paid'
                        WHEN status = 'paid' AND v_status <> 'paid' THEN status
                        ELSE v_status
                    END,
                    created_at = CASE
                        WHEN COALESCE((v_existing_metadata->>'provider_order_resolved')::BOOLEAN, FALSE) = FALSE
                             OR UPPER(COALESCE(v_existing_order.provider_order_no, '')) LIKE 'PENDING\_%'
                            THEN COALESCE(v_existing_order.paid_at, v_now)
                        ELSE v_existing_order.created_at
                    END,
                    updated_at = v_now
                WHERE id = v_existing_order.id
                RETURNING id, redemption_code INTO v_payment_order_id, v_existing_code;

                v_targeted_update_applied := TRUE;
            END IF;
        END IF;
    END IF;

    IF v_payment_order_id IS NULL THEN
        INSERT INTO public.payment_orders (
            provider,
            provider_order_no,
            provider_user_id,
            plan_id,
            site,
            package_id,
            package_name,
            checkout_session_id,
            expected_amount,
            paid_amount,
            points_amount,
            status,
            sign_verified,
            amount_verified,
            raw_payload,
            provider_metadata,
            paid_at,
            verified_at,
            last_error
        ) VALUES (
            'afdian',
            p_order_no,
            p_afdian_user_id,
            p_plan_id,
            p_site,
            p_package_id,
            p_package_name,
            NULL,
            p_expected_amount,
            p_paid_amount,
            GREATEST(COALESCE(p_points, 0), 0),
            v_status,
            COALESCE(p_signature_valid, false),
            COALESCE(p_amount_valid, false),
            COALESCE(p_payload, '{}'::JSONB),
            jsonb_strip_nulls(jsonb_build_object(
                'plan_id', p_plan_id,
                'package_name', p_package_name,
                'provider_order_resolved', TRUE,
                'provider_order_resolved_at', v_now
            )),
            CASE WHEN v_status = 'paid' THEN v_now ELSE NULL END,
            CASE
                WHEN COALESCE(p_signature_valid, false) AND COALESCE(p_amount_valid, false)
                    THEN v_now
                ELSE NULL
            END,
            NULLIF(BTRIM(COALESCE(p_error, '')), '')
        )
        ON CONFLICT (provider, provider_order_no) DO UPDATE SET
            provider_user_id = COALESCE(EXCLUDED.provider_user_id, payment_orders.provider_user_id),
            plan_id = COALESCE(EXCLUDED.plan_id, payment_orders.plan_id),
            site = COALESCE(EXCLUDED.site, payment_orders.site),
            package_id = COALESCE(EXCLUDED.package_id, payment_orders.package_id),
            package_name = COALESCE(EXCLUDED.package_name, payment_orders.package_name),
            expected_amount = COALESCE(EXCLUDED.expected_amount, payment_orders.expected_amount),
            paid_amount = COALESCE(EXCLUDED.paid_amount, payment_orders.paid_amount),
            points_amount = GREATEST(COALESCE(payment_orders.points_amount, 0), COALESCE(EXCLUDED.points_amount, 0)),
            sign_verified = COALESCE(payment_orders.sign_verified, false) OR COALESCE(EXCLUDED.sign_verified, false),
            amount_verified = COALESCE(payment_orders.amount_verified, false) OR COALESCE(EXCLUDED.amount_verified, false),
            raw_payload = COALESCE(payment_orders.raw_payload, '{}'::JSONB) || COALESCE(EXCLUDED.raw_payload, '{}'::JSONB),
            provider_metadata = COALESCE(payment_orders.provider_metadata, '{}'::JSONB)
                || COALESCE(EXCLUDED.provider_metadata, '{}'::JSONB)
                || jsonb_build_object(
                    'provider_order_resolved', TRUE,
                    'provider_order_resolved_at', v_now
                ),
            paid_at = COALESCE(payment_orders.paid_at, EXCLUDED.paid_at),
            verified_at = COALESCE(payment_orders.verified_at, EXCLUDED.verified_at),
            last_error = CASE
                WHEN EXCLUDED.status = 'paid' THEN NULL
                ELSE COALESCE(NULLIF(EXCLUDED.last_error, ''), payment_orders.last_error)
            END,
            status = CASE
                WHEN payment_orders.status = 'redeemed' THEN payment_orders.status
                WHEN EXCLUDED.status = 'paid' THEN 'paid'
                WHEN payment_orders.status = 'paid' AND EXCLUDED.status <> 'paid' THEN payment_orders.status
                ELSE EXCLUDED.status
            END,
            updated_at = v_now
        RETURNING id, redemption_code INTO v_payment_order_id, v_existing_code;
    ELSIF NOT v_targeted_update_applied THEN
        SELECT redemption_code
        INTO v_existing_code
        FROM public.payment_orders
        WHERE id = v_payment_order_id;
    END IF;

    v_effective_code := v_existing_code;

    IF v_status = 'paid' THEN
        v_effective_code := public.fn_ensure_redemption_code_for_payment_order(
            v_payment_order_id,
            p_package_id,
            GREATEST(COALESCE(p_points, 0), 0),
            p_site,
            p_order_no
        );
    END IF;

    INSERT INTO public.afdian_orders (
        out_trade_no,
        afdian_user_id,
        plan_id,
        total_amount,
        points,
        redeem_code,
        is_redeemed,
        remark,
        raw_payload,
        site,
        payment_status,
        sign_verified,
        amount_verified,
        paid_at,
        verified_at,
        payment_order_id
    ) VALUES (
        p_order_no,
        p_afdian_user_id,
        p_plan_id,
        COALESCE(p_paid_amount, 0),
        GREATEST(COALESCE(p_points, 0), 0),
        v_effective_code,
        false,
        NULL,
        COALESCE(p_payload, '{}'::JSONB),
        p_site,
        v_status,
        COALESCE(p_signature_valid, false),
        COALESCE(p_amount_valid, false),
        CASE WHEN v_status = 'paid' THEN v_now ELSE NULL END,
        CASE
            WHEN COALESCE(p_signature_valid, false) AND COALESCE(p_amount_valid, false)
                THEN v_now
            ELSE NULL
        END,
        v_payment_order_id
    )
    ON CONFLICT (out_trade_no) DO UPDATE SET
        afdian_user_id = COALESCE(EXCLUDED.afdian_user_id, afdian_orders.afdian_user_id),
        plan_id = COALESCE(EXCLUDED.plan_id, afdian_orders.plan_id),
        total_amount = COALESCE(EXCLUDED.total_amount, afdian_orders.total_amount),
        points = GREATEST(COALESCE(afdian_orders.points, 0), COALESCE(EXCLUDED.points, 0)),
        redeem_code = COALESCE(afdian_orders.redeem_code, EXCLUDED.redeem_code),
        raw_payload = COALESCE(afdian_orders.raw_payload, '{}'::JSONB) || COALESCE(EXCLUDED.raw_payload, '{}'::JSONB),
        site = COALESCE(EXCLUDED.site, afdian_orders.site),
        payment_order_id = COALESCE(afdian_orders.payment_order_id, EXCLUDED.payment_order_id),
        payment_status = CASE
            WHEN afdian_orders.payment_status = 'redeemed' THEN afdian_orders.payment_status
            WHEN EXCLUDED.payment_status = 'paid' THEN 'paid'
            WHEN afdian_orders.payment_status = 'paid' AND EXCLUDED.payment_status <> 'paid' THEN afdian_orders.payment_status
            ELSE EXCLUDED.payment_status
        END,
        sign_verified = COALESCE(afdian_orders.sign_verified, false) OR COALESCE(EXCLUDED.sign_verified, false),
        amount_verified = COALESCE(afdian_orders.amount_verified, false) OR COALESCE(EXCLUDED.amount_verified, false),
        paid_at = COALESCE(afdian_orders.paid_at, EXCLUDED.paid_at),
        verified_at = COALESCE(afdian_orders.verified_at, EXCLUDED.verified_at)
    RETURNING redeem_code INTO v_effective_code;

    RETURN jsonb_build_object(
        'payment_order_id', v_payment_order_id,
        'status', v_status,
        'code', v_effective_code,
        'points', GREATEST(COALESCE(p_points, 0), 0),
        'requires_review', v_status <> 'paid'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_process_afdian_payment(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, UUID, TEXT, VARCHAR, BOOLEAN, BOOLEAN, JSONB, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_process_afdian_payment(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, UUID, TEXT, VARCHAR, BOOLEAN, BOOLEAN, JSONB, TEXT, UUID) TO service_role;

DROP FUNCTION IF EXISTS public.fn_finalize_afdian_custom_payment(TEXT, UUID, VARCHAR, INTEGER, NUMERIC, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.fn_finalize_afdian_custom_payment(
    p_order_no TEXT,
    p_user_id UUID,
    p_site VARCHAR DEFAULT 'cn',
    p_points INTEGER DEFAULT 0,
    p_expected_amount NUMERIC DEFAULT NULL,
    p_quote_id TEXT DEFAULT NULL,
    p_package_name TEXT DEFAULT '自定义充值'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_order public.afdian_orders%ROWTYPE;
    v_resolved_order public.payment_orders%ROWTYPE;
    v_quote_order public.payment_orders%ROWTYPE;
    v_target_order public.payment_orders%ROWTYPE;
    v_effective_code TEXT;
    v_effective_amount NUMERIC(10,2);
    v_quote_id TEXT := NULLIF(BTRIM(COALESCE(p_quote_id, '')), '');
    v_package_name TEXT := COALESCE(NULLIF(BTRIM(COALESCE(p_package_name, '')), ''), '自定义充值');
    v_quote_metadata JSONB := '{}'::JSONB;
    v_target_metadata JSONB := '{}'::JSONB;
    v_target_raw_payload JSONB := '{}'::JSONB;
    v_amount_matches BOOLEAN := FALSE;
BEGIN
    IF COALESCE(BTRIM(p_order_no), '') = '' THEN
        RAISE EXCEPTION 'order_no is required';
    END IF;

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id is required';
    END IF;

    IF COALESCE(p_points, 0) <= 0 THEN
        RAISE EXCEPTION 'points must be greater than 0';
    END IF;

    IF p_expected_amount IS NULL OR p_expected_amount <= 0 THEN
        RAISE EXCEPTION 'expected_amount must be greater than 0';
    END IF;

    p_site := COALESCE(NULLIF(BTRIM(p_site), ''), 'cn');

    SELECT *
    INTO v_order
    FROM public.afdian_orders
    WHERE out_trade_no = p_order_no
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'afdian order not found';
    END IF;

    IF v_order.site_user_id IS NOT NULL AND v_order.site_user_id <> p_user_id THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF NOT COALESCE(v_order.sign_verified, false) THEN
        RAISE EXCEPTION 'afdian order signature not verified';
    END IF;

    SELECT *
    INTO v_resolved_order
    FROM public.payment_orders
    WHERE provider = 'afdian'
      AND provider_order_no = p_order_no
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND AND v_resolved_order.user_id IS NOT NULL AND v_resolved_order.user_id <> p_user_id THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF v_quote_id IS NOT NULL THEN
        SELECT *
        INTO v_quote_order
        FROM public.payment_orders
        WHERE provider = 'afdian'
          AND user_id = p_user_id
          AND COALESCE(provider_metadata->>'custom_quote_id', '') = v_quote_id
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE;
    END IF;

    v_effective_amount := COALESCE(v_order.total_amount, v_resolved_order.paid_amount, 0);
    v_amount_matches := ABS(COALESCE(v_effective_amount, 0) - COALESCE(p_expected_amount, 0)) <= 0.01;
    IF NOT v_amount_matches THEN
        RAISE EXCEPTION 'paid amount does not match quoted amount';
    END IF;

    IF v_quote_order.id IS NOT NULL THEN
        v_quote_metadata := COALESCE(v_quote_order.provider_metadata, '{}'::JSONB);
    END IF;

    IF v_resolved_order.id IS NOT NULL THEN
        v_target_order := v_resolved_order;

        IF v_quote_order.id IS NOT NULL AND v_quote_order.id <> v_resolved_order.id THEN
            UPDATE public.payment_orders
            SET
                checkout_session_id = COALESCE(payment_orders.checkout_session_id, v_quote_order.checkout_session_id),
                user_id = COALESCE(payment_orders.user_id, p_user_id),
                site = COALESCE(NULLIF(BTRIM(p_site), ''), payment_orders.site),
                expected_amount = COALESCE(p_expected_amount, payment_orders.expected_amount),
                package_name = COALESCE(NULLIF(BTRIM(v_package_name), ''), payment_orders.package_name),
                provider_metadata = COALESCE(payment_orders.provider_metadata, '{}'::JSONB)
                    || jsonb_strip_nulls(jsonb_build_object(
                        'charge_type', 'custom',
                        'custom_quote_id', v_quote_id,
                        'custom_quote', v_quote_metadata->'custom_quote',
                        'custom_amount_reconciled_at', v_now,
                        'custom_amount_reconciled_from_payment_order_id', v_quote_order.id
                    )),
                updated_at = v_now
            WHERE id = v_resolved_order.id
            RETURNING * INTO v_target_order;

            UPDATE public.payment_orders
            SET
                checkout_session_id = NULL,
                provider_metadata = COALESCE(provider_metadata, '{}'::JSONB)
                    || jsonb_strip_nulls(jsonb_build_object(
                        'provider_order_pending', TRUE,
                        'provider_order_resolved', FALSE,
                        'checkout_session_detached_at', v_now,
                        'checkout_session_detached_by', 'fn_finalize_afdian_custom_payment',
                        'superseded_by_payment_order_id', v_resolved_order.id
                    )),
                last_error = COALESCE(NULLIF(BTRIM(last_error), ''), 'merged_into_finalized_custom_payment'),
                updated_at = v_now
            WHERE id = v_quote_order.id
              AND v_quote_order.checkout_session_id IS NOT NULL;
        END IF;
    ELSIF v_quote_order.id IS NOT NULL THEN
        UPDATE public.payment_orders
        SET
            provider_order_no = p_order_no,
            site = COALESCE(NULLIF(BTRIM(p_site), ''), site),
            package_id = NULL,
            package_name = v_package_name,
            expected_amount = COALESCE(p_expected_amount, expected_amount),
            paid_amount = COALESCE(v_effective_amount, paid_amount),
            points_amount = GREATEST(COALESCE(points_amount, 0), COALESCE(p_points, 0)),
            sign_verified = TRUE,
            amount_verified = TRUE,
            provider_metadata = COALESCE(provider_metadata, '{}'::JSONB)
                || jsonb_strip_nulls(jsonb_build_object(
                    'charge_type', 'custom',
                    'custom_quote_id', v_quote_id,
                    'custom_quote', v_quote_metadata->'custom_quote',
                    'custom_amount_reconciled_at', v_now,
                    'provider_order_resolved', TRUE,
                    'provider_order_resolved_at', v_now
                )),
            paid_at = COALESCE(paid_at, v_now),
            verified_at = COALESCE(verified_at, v_now),
            last_error = NULL,
            status = CASE
                WHEN status = 'redeemed' THEN status
                ELSE 'paid'
            END,
            updated_at = v_now
        WHERE id = v_quote_order.id
        RETURNING * INTO v_target_order;
    ELSE
        INSERT INTO public.payment_orders (
            provider,
            provider_order_no,
            user_id,
            site,
            package_id,
            package_name,
            expected_amount,
            paid_amount,
            points_amount,
            status,
            sign_verified,
            amount_verified,
            raw_payload,
            provider_metadata,
            paid_at,
            verified_at,
            last_error,
            created_at,
            updated_at
        ) VALUES (
            'afdian',
            p_order_no,
            p_user_id,
            p_site,
            NULL,
            v_package_name,
            p_expected_amount,
            v_effective_amount,
            GREATEST(COALESCE(p_points, 0), 0),
            'paid',
            TRUE,
            TRUE,
            COALESCE(v_order.raw_payload, '{}'::JSONB),
            jsonb_strip_nulls(jsonb_build_object(
                'charge_type', 'custom',
                'custom_quote_id', v_quote_id,
                'custom_amount_reconciled_at', v_now,
                'provider_order_resolved', TRUE,
                'provider_order_resolved_at', v_now
            )),
            v_now,
            v_now,
            NULL,
            v_now,
            v_now
        )
        RETURNING * INTO v_target_order;
    END IF;

    v_target_metadata := COALESCE(v_target_order.provider_metadata, '{}'::JSONB);
    v_target_raw_payload := COALESCE(v_target_order.raw_payload, '{}'::JSONB) || COALESCE(v_order.raw_payload, '{}'::JSONB);

    UPDATE public.payment_orders
    SET
        user_id = COALESCE(user_id, p_user_id),
        site = COALESCE(NULLIF(BTRIM(p_site), ''), site),
        package_id = NULL,
        package_name = v_package_name,
        expected_amount = COALESCE(p_expected_amount, expected_amount),
        paid_amount = COALESCE(v_effective_amount, paid_amount),
        points_amount = GREATEST(COALESCE(points_amount, 0), COALESCE(p_points, 0)),
        sign_verified = TRUE,
        amount_verified = TRUE,
        raw_payload = v_target_raw_payload,
        provider_metadata = v_target_metadata || jsonb_strip_nulls(jsonb_build_object(
            'charge_type', 'custom',
            'custom_quote_id', v_quote_id,
            'custom_quote', COALESCE(v_quote_metadata->'custom_quote', v_target_metadata->'custom_quote'),
            'custom_amount_reconciled_at', v_now,
            'provider_order_resolved', TRUE,
            'provider_order_resolved_at', v_now
        )),
        paid_at = COALESCE(paid_at, v_now),
        verified_at = COALESCE(verified_at, v_now),
        last_error = NULL,
        status = CASE
            WHEN status = 'redeemed' THEN status
            ELSE 'paid'
        END,
        updated_at = v_now
    WHERE id = v_target_order.id
    RETURNING * INTO v_target_order;

    v_effective_code := public.fn_ensure_redemption_code_for_payment_order(
        v_target_order.id,
        NULL,
        GREATEST(COALESCE(p_points, 0), 0),
        p_site,
        p_order_no
    );

    UPDATE public.afdian_orders
    SET
        site = COALESCE(NULLIF(BTRIM(p_site), ''), site),
        site_user_id = COALESCE(site_user_id, p_user_id),
        claimed_at = COALESCE(claimed_at, v_now),
        points = GREATEST(COALESCE(points, 0), COALESCE(p_points, 0)),
        redeem_code = COALESCE(redeem_code, v_effective_code),
        payment_status = CASE
            WHEN payment_status = 'redeemed' THEN payment_status
            ELSE 'paid'
        END,
        sign_verified = TRUE,
        amount_verified = TRUE,
        paid_at = COALESCE(paid_at, v_now),
        verified_at = COALESCE(verified_at, v_now),
        payment_order_id = v_target_order.id
    WHERE id = v_order.id;

    RETURN jsonb_build_object(
        'payment_order_id', v_target_order.id,
        'checkout_session_id', v_target_order.checkout_session_id,
        'status', CASE WHEN v_target_order.status = 'redeemed' THEN v_target_order.status ELSE 'paid' END,
        'code', v_effective_code,
        'points', GREATEST(COALESCE(v_target_order.points_amount, 0), COALESCE(p_points, 0)),
        'quote_id', v_quote_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_finalize_afdian_custom_payment(TEXT, UUID, VARCHAR, INTEGER, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_finalize_afdian_custom_payment(TEXT, UUID, VARCHAR, INTEGER, NUMERIC, TEXT, TEXT) TO service_role;

DROP FUNCTION IF EXISTS public.fn_claim_and_query_afdian_code(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.fn_claim_and_query_afdian_code(
    p_order_no TEXT,
    p_user_id UUID
)
RETURNS TABLE (
    code TEXT,
    points INTEGER,
    is_redeemed BOOLEAN,
    created_at TIMESTAMPTZ,
    payment_status TEXT,
    sign_verified BOOLEAN,
    amount_verified BOOLEAN,
    last_error TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order RECORD;
    v_payment RECORD;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'auth required';
    END IF;

    SELECT *
    INTO v_order
    FROM public.afdian_orders
    WHERE out_trade_no = p_order_no
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF v_order.payment_order_id IS NOT NULL THEN
        SELECT *
        INTO v_payment
        FROM public.payment_orders
        WHERE id = v_order.payment_order_id
        FOR UPDATE;
    END IF;

    IF v_order.site_user_id IS NOT NULL AND v_order.site_user_id <> p_user_id THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF v_payment.id IS NOT NULL AND v_payment.user_id IS NOT NULL AND v_payment.user_id <> p_user_id THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF v_order.site_user_id IS NULL THEN
        UPDATE public.afdian_orders
        SET
            site_user_id = p_user_id,
            claimed_at = COALESCE(claimed_at, NOW())
        WHERE id = v_order.id;
    END IF;

    IF v_payment.id IS NOT NULL AND v_payment.user_id IS NULL THEN
        UPDATE public.payment_orders
        SET
            user_id = p_user_id,
            claimed_at = COALESCE(claimed_at, NOW())
        WHERE id = v_payment.id;
    END IF;

    RETURN QUERY
    SELECT
        ao.redeem_code,
        COALESCE(rc.points_amount, ao.points, 0),
        COALESCE(rc.status = 'used', ao.is_redeemed, false),
        ao.created_at,
        COALESCE(po.status, ao.payment_status, 'pending')::TEXT,
        COALESCE(po.sign_verified, ao.sign_verified, false),
        COALESCE(po.amount_verified, ao.amount_verified, false),
        po.last_error
    FROM public.afdian_orders ao
    LEFT JOIN public.payment_orders po
        ON po.id = ao.payment_order_id
    LEFT JOIN public.redemption_codes rc
        ON rc.code = ao.redeem_code
    WHERE ao.id = v_order.id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_claim_and_query_afdian_code(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_claim_and_query_afdian_code(TEXT, UUID) TO service_role;

DROP FUNCTION IF EXISTS public.fn_query_afdian_code(TEXT);

CREATE OR REPLACE FUNCTION public.fn_query_afdian_code(
    p_order_no TEXT
)
RETURNS TABLE (
    code TEXT,
    points INTEGER,
    is_redeemed BOOLEAN,
    created_at TIMESTAMPTZ,
    payment_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ao.redeem_code,
        COALESCE(rc.points_amount, ao.points, 0),
        COALESCE(rc.status = 'used', ao.is_redeemed, false),
        ao.created_at,
        COALESCE(po.status, ao.payment_status, 'pending')::TEXT
    FROM public.afdian_orders ao
    LEFT JOIN public.payment_orders po
        ON po.id = ao.payment_order_id
    LEFT JOIN public.redemption_codes rc
        ON rc.code = ao.redeem_code
    WHERE ao.out_trade_no = p_order_no;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_query_afdian_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_query_afdian_code(TEXT) TO service_role;

DROP FUNCTION IF EXISTS public.get_payment_overview(INTEGER, VARCHAR);

CREATE OR REPLACE FUNCTION public.get_payment_overview(
    p_days INTEGER DEFAULT 30,
    p_site VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_total_orders BIGINT := 0;
    v_paid_orders BIGINT := 0;
    v_redeemed_orders BIGINT := 0;
    v_claimed_orders BIGINT := 0;
    v_review_orders BIGINT := 0;
    v_failed_orders BIGINT := 0;
    v_total_amount NUMERIC(12,2) := 0;
    v_total_points BIGINT := 0;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE status IN ('paid', 'redeemed')),
        COUNT(*) FILTER (WHERE status = 'redeemed'),
        COUNT(*) FILTER (WHERE user_id IS NOT NULL),
        COUNT(*) FILTER (WHERE status = 'pending_review'),
        COUNT(*) FILTER (WHERE status IN ('rejected', 'amount_mismatch')),
        COALESCE(SUM(paid_amount) FILTER (WHERE status IN ('paid', 'redeemed')), 0),
        COALESCE(SUM(points_amount) FILTER (WHERE status IN ('paid', 'redeemed')), 0)
    INTO
        v_total_orders,
        v_paid_orders,
        v_redeemed_orders,
        v_claimed_orders,
        v_review_orders,
        v_failed_orders,
        v_total_amount,
        v_total_points
    FROM public.payment_orders
    WHERE provider = 'afdian'
      AND created_at >= NOW() - make_interval(days => GREATEST(COALESCE(p_days, 30), 1))
      AND (p_site IS NULL OR site = p_site);

    RETURN jsonb_build_object(
        'total_orders', v_total_orders,
        'paid_orders', v_paid_orders,
        'redeemed_orders', v_redeemed_orders,
        'claimed_orders', v_claimed_orders,
        'review_orders', v_review_orders,
        'failed_orders', v_failed_orders,
        'total_amount', v_total_amount,
        'total_points', v_total_points,
        'paid_rate', CASE
            WHEN v_total_orders > 0 THEN ROUND((v_paid_orders::NUMERIC / v_total_orders::NUMERIC) * 100, 2)
            ELSE 0
        END,
        'claim_rate', CASE
            WHEN v_paid_orders > 0 THEN ROUND((v_claimed_orders::NUMERIC / v_paid_orders::NUMERIC) * 100, 2)
            ELSE 0
        END
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_payment_overview(INTEGER, VARCHAR) TO authenticated;

INSERT INTO public.payment_orders (
    provider,
    provider_order_no,
    provider_user_id,
    plan_id,
    user_id,
    site,
    expected_amount,
    paid_amount,
    points_amount,
    status,
    sign_verified,
    amount_verified,
    raw_payload,
    redemption_code,
    paid_at,
    claimed_at,
    created_at,
    last_error
)
SELECT
    'afdian',
    ao.out_trade_no,
    ao.afdian_user_id,
    ao.plan_id,
    ao.site_user_id,
    COALESCE(ao.site, 'cn'),
    ao.total_amount,
    ao.total_amount,
    COALESCE(ao.points, 0),
    CASE
        WHEN ao.is_redeemed THEN 'redeemed'
        WHEN ao.redeem_code IS NOT NULL THEN 'paid'
        ELSE COALESCE(NULLIF(ao.payment_status, ''), 'pending_review')
    END,
    COALESCE(ao.sign_verified, false),
    COALESCE(ao.amount_verified, false),
    COALESCE(ao.raw_payload, '{}'::JSONB),
    ao.redeem_code,
    ao.paid_at,
    ao.claimed_at,
    COALESCE(ao.created_at, NOW()),
    NULL
FROM public.afdian_orders ao
ON CONFLICT (provider, provider_order_no) DO UPDATE SET
    provider_user_id = COALESCE(payment_orders.provider_user_id, EXCLUDED.provider_user_id),
    plan_id = COALESCE(payment_orders.plan_id, EXCLUDED.plan_id),
    user_id = COALESCE(payment_orders.user_id, EXCLUDED.user_id),
    site = COALESCE(payment_orders.site, EXCLUDED.site),
    expected_amount = COALESCE(payment_orders.expected_amount, EXCLUDED.expected_amount),
    paid_amount = COALESCE(payment_orders.paid_amount, EXCLUDED.paid_amount),
    points_amount = GREATEST(COALESCE(payment_orders.points_amount, 0), COALESCE(EXCLUDED.points_amount, 0)),
    redemption_code = COALESCE(payment_orders.redemption_code, EXCLUDED.redemption_code),
    paid_at = COALESCE(payment_orders.paid_at, EXCLUDED.paid_at),
    claimed_at = COALESCE(payment_orders.claimed_at, EXCLUDED.claimed_at),
    status = CASE
        WHEN payment_orders.status = 'redeemed' THEN payment_orders.status
        WHEN EXCLUDED.status = 'redeemed' THEN 'redeemed'
        WHEN EXCLUDED.status = 'paid' AND payment_orders.status <> 'redeemed' THEN 'paid'
        ELSE payment_orders.status
    END;

UPDATE public.afdian_orders ao
SET payment_order_id = po.id
FROM public.payment_orders po
WHERE po.provider = 'afdian'
  AND po.provider_order_no = ao.out_trade_no
  AND (ao.payment_order_id IS NULL OR ao.payment_order_id <> po.id);

UPDATE public.afdian_orders ao
SET
    is_redeemed = true,
    redeemed_at = COALESCE(ao.redeemed_at, rc.used_at, NOW())
FROM public.redemption_codes rc
WHERE rc.code = ao.redeem_code
  AND rc.status = 'used'
  AND COALESCE(ao.is_redeemed, false) = false;

UPDATE public.payment_orders po
SET status = 'redeemed'
FROM public.redemption_codes rc
WHERE po.provider = 'afdian'
  AND po.redemption_code = rc.code
  AND rc.status = 'used'
  AND po.status <> 'redeemed';
