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
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_event_key
    ON public.payment_events(event_key);
CREATE INDEX IF NOT EXISTS idx_payment_events_provider_created_at
    ON public.payment_events(provider, created_at DESC);

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
ALTER TABLE public.afdian_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own payment orders" ON public.payment_orders;
DROP POLICY IF EXISTS "Admins view all payment orders" ON public.payment_orders;
DROP POLICY IF EXISTS "Admins view payment events" ON public.payment_events;
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
    p_error TEXT DEFAULT NULL
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
BEGIN
    IF COALESCE(trim(p_order_no), '') = '' THEN
        RAISE EXCEPTION 'order_no is required';
    END IF;

    p_site := COALESCE(NULLIF(trim(p_site), ''), 'cn');
    v_status := CASE
        WHEN NOT COALESCE(p_signature_valid, false) THEN 'rejected'
        WHEN NOT COALESCE(p_amount_valid, false) THEN 'amount_mismatch'
        WHEN COALESCE(p_points, 0) <= 0 THEN 'pending_review'
        ELSE 'paid'
    END;

    INSERT INTO public.payment_orders (
        provider,
        provider_order_no,
        provider_user_id,
        plan_id,
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
        last_error
    ) VALUES (
        'afdian',
        p_order_no,
        p_afdian_user_id,
        p_plan_id,
        p_site,
        p_package_id,
        p_package_name,
        p_expected_amount,
        p_paid_amount,
        GREATEST(COALESCE(p_points, 0), 0),
        v_status,
        COALESCE(p_signature_valid, false),
        COALESCE(p_amount_valid, false),
        COALESCE(p_payload, '{}'::JSONB),
        jsonb_build_object(
            'plan_id', p_plan_id,
            'package_name', p_package_name
        ),
        CASE WHEN v_status = 'paid' THEN v_now ELSE NULL END,
        CASE
            WHEN COALESCE(p_signature_valid, false) AND COALESCE(p_amount_valid, false)
                THEN v_now
            ELSE NULL
        END,
        NULLIF(trim(COALESCE(p_error, '')), '')
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
        raw_payload = COALESCE(EXCLUDED.raw_payload, payment_orders.raw_payload),
        provider_metadata = COALESCE(payment_orders.provider_metadata, '{}'::JSONB) || COALESCE(EXCLUDED.provider_metadata, '{}'::JSONB),
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
        END
    RETURNING id, redemption_code INTO v_payment_order_id, v_existing_code;

    v_effective_code := v_existing_code;

    IF v_status = 'paid' AND COALESCE(v_effective_code, '') = '' THEN
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
                    p_package_id,
                    GREATEST(COALESCE(p_points, 0), 0),
                    'pending',
                    p_site,
                    p_order_no
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

    IF COALESCE(v_effective_code, '') <> '' THEN
        INSERT INTO public.redemption_codes (
            code,
            package_id,
            points_amount,
            status,
            site,
            external_order_id
        ) VALUES (
            v_effective_code,
            p_package_id,
            GREATEST(COALESCE(p_points, 0), 0),
            'pending',
            p_site,
            p_order_no
        )
        ON CONFLICT (code) DO UPDATE SET
            package_id = COALESCE(redemption_codes.package_id, EXCLUDED.package_id),
            points_amount = COALESCE(redemption_codes.points_amount, EXCLUDED.points_amount),
            site = COALESCE(redemption_codes.site, EXCLUDED.site),
            external_order_id = COALESCE(redemption_codes.external_order_id, EXCLUDED.external_order_id);

        UPDATE public.payment_orders
        SET
            redemption_code = v_effective_code,
            updated_at = NOW(),
            last_error = NULL
        WHERE id = v_payment_order_id;
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
        raw_payload = COALESCE(EXCLUDED.raw_payload, afdian_orders.raw_payload),
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

REVOKE ALL ON FUNCTION public.fn_process_afdian_payment(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, UUID, TEXT, VARCHAR, BOOLEAN, BOOLEAN, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_process_afdian_payment(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, UUID, TEXT, VARCHAR, BOOLEAN, BOOLEAN, JSONB, TEXT) TO service_role;

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
        COALESCE(po.status, ao.payment_status, 'pending'),
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
        COALESCE(po.status, ao.payment_status, 'pending')
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
