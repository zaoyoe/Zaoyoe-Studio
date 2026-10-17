-- Operator-applied only. No product switches, prices, existing orders or secrets change.
BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_usdt_fx_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_start TIMESTAMPTZ NOT NULL UNIQUE,
    source TEXT NOT NULL CHECK (source = 'coingecko:tether/cny'),
    cny_per_usdt NUMERIC(20,8) NOT NULL CHECK (cny_per_usdt BETWEEN 2 AND 20),
    usdt_per_cny NUMERIC(12,8) NOT NULL CHECK (usdt_per_cny = round(1 / cny_per_usdt, 8)),
    source_updated_at TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    CHECK (bucket_start = to_timestamp(floor(extract(epoch FROM bucket_start) / 300) * 300)),
    CHECK (fetched_at >= bucket_start AND fetched_at < bucket_start + interval '5 minutes'),
    CHECK (source_updated_at <= fetched_at + interval '1 minute' AND source_updated_at >= fetched_at - interval '10 minutes'),
    CHECK (expires_at > fetched_at AND expires_at <= bucket_start + interval '5 minutes'
        AND expires_at <= source_updated_at + interval '10 minutes')
);

-- A separate immutable relation preserves the existing TG quote identity guard.
CREATE TABLE IF NOT EXISTS public.tg_purchase_fx_quotes (
    quote_id UUID PRIMARY KEY REFERENCES public.tg_purchase_quotes(id) ON DELETE RESTRICT,
    fx_snapshot_id UUID NOT NULL REFERENCES public.payment_usdt_fx_snapshots(id) ON DELETE RESTRICT,
    usdt_pay_amount NUMERIC(20,2) NOT NULL CHECK (usdt_pay_amount > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.payment_guard_fx_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'Payment FX snapshot is immutable' USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS trg_payment_fx_immutable ON public.payment_usdt_fx_snapshots;
CREATE TRIGGER trg_payment_fx_immutable BEFORE UPDATE OR DELETE ON public.payment_usdt_fx_snapshots
    FOR EACH ROW EXECUTE FUNCTION public.payment_guard_fx_snapshot();
DROP TRIGGER IF EXISTS trg_tg_purchase_fx_immutable ON public.tg_purchase_fx_quotes;
CREATE TRIGGER trg_tg_purchase_fx_immutable BEFORE UPDATE OR DELETE ON public.tg_purchase_fx_quotes
    FOR EACH ROW EXECUTE FUNCTION public.payment_guard_fx_snapshot();

CREATE OR REPLACE FUNCTION public.payment_usdt_fx_json(p_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_build_object('id', f.id, 'source', f.source, 'cny_per_usdt', f.cny_per_usdt::TEXT,
        'usdt_per_cny', f.usdt_per_cny::TEXT, 'source_updated_at', f.source_updated_at,
        'fetched_at', f.fetched_at, 'expires_at', f.expires_at)
    FROM public.payment_usdt_fx_snapshots f WHERE f.id = p_id;
$$;
CREATE OR REPLACE FUNCTION public.fn_payment_usdt_fx_current()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT public.payment_usdt_fx_json(f.id) FROM public.payment_usdt_fx_snapshots f
    WHERE f.bucket_start = to_timestamp(floor(extract(epoch FROM now()) / 300) * 300)
        AND f.expires_at > now() AND f.source_updated_at >= now() - interval '10 minutes';
$$;
CREATE OR REPLACE FUNCTION public.fn_payment_usdt_fx_publish(p_cny_per_usdt NUMERIC, p_source_updated_at TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id UUID; v_bucket TIMESTAMPTZ := to_timestamp(floor(extract(epoch FROM now()) / 300) * 300);
    v_price NUMERIC(20,8) := round(p_cny_per_usdt, 8);
BEGIN
    IF p_cny_per_usdt IS NULL OR p_cny_per_usdt NOT BETWEEN 2 AND 20
        OR p_source_updated_at IS NULL OR p_source_updated_at > now() + interval '1 minute'
        OR p_source_updated_at <= now() - interval '10 minutes' THEN
        RAISE EXCEPTION 'Invalid market FX source' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.payment_usdt_fx_snapshots(bucket_start, source, cny_per_usdt, usdt_per_cny, source_updated_at, expires_at)
    VALUES(v_bucket, 'coingecko:tether/cny', v_price, round(1 / v_price, 8), p_source_updated_at,
        least(v_bucket + interval '5 minutes', p_source_updated_at + interval '10 minutes'))
    ON CONFLICT (bucket_start) DO NOTHING;
    SELECT f.id INTO v_id FROM public.payment_usdt_fx_snapshots f WHERE f.bucket_start = v_bucket AND f.expires_at > now();
    IF v_id IS NULL THEN RAISE EXCEPTION 'Market FX expired' USING ERRCODE = '23514'; END IF;
    RETURN public.payment_usdt_fx_json(v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_purchase_fx_quote(p_quote_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_build_object('quote_id', q.id, 'total_minor', q.total_minor,
        'usdt_pay_amount', b.usdt_pay_amount::TEXT, 'fx', public.payment_usdt_fx_json(b.fx_snapshot_id))
    FROM public.tg_purchase_fx_quotes b JOIN public.tg_purchase_quotes q ON q.id = b.quote_id WHERE q.id = p_quote_id;
$$;
CREATE OR REPLACE FUNCTION public.fn_tg_bind_purchase_fx_quote(p_quote_id UUID, p_fx_snapshot_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_quote public.tg_purchase_quotes%ROWTYPE; v_fx public.payment_usdt_fx_snapshots%ROWTYPE;
BEGIN
    SELECT * INTO v_quote FROM public.tg_purchase_quotes WHERE id = p_quote_id FOR UPDATE;
    IF v_quote.id IS NULL OR v_quote.payment_channel IS DISTINCT FROM 'usdt_bep20' OR v_quote.expires_at <= now() THEN
        RAISE EXCEPTION 'Invalid TG FX quote' USING ERRCODE = '23514';
    END IF;
    IF EXISTS(SELECT 1 FROM public.tg_purchase_fx_quotes WHERE quote_id = p_quote_id) THEN
        RETURN public.fn_tg_purchase_fx_quote(p_quote_id);
    END IF;
    SELECT * INTO v_fx FROM public.payment_usdt_fx_snapshots WHERE id = p_fx_snapshot_id AND expires_at > now();
    IF v_fx.id IS NULL THEN RAISE EXCEPTION 'Market FX expired' USING ERRCODE = '23514'; END IF;
    INSERT INTO public.tg_purchase_fx_quotes(quote_id, fx_snapshot_id, usdt_pay_amount)
        VALUES(p_quote_id, p_fx_snapshot_id, ceil(v_quote.total_minor * v_fx.usdt_per_cny) / 100);
    RETURN public.fn_tg_purchase_fx_quote(p_quote_id);
END;
$$;

ALTER TABLE public.payment_usdt_fx_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tg_purchase_fx_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_usdt_fx_snapshots, public.tg_purchase_fx_quotes FROM PUBLIC, anon, authenticated, service_role;
-- The service uses only the validated definer RPCs, including publication.
DO $$
DECLARE v_signature TEXT; v_function REGPROCEDURE;
BEGIN
    FOREACH v_signature IN ARRAY ARRAY[
        'public.payment_guard_fx_snapshot()', 'public.payment_usdt_fx_json(uuid)',
        'public.fn_payment_usdt_fx_current()', 'public.fn_payment_usdt_fx_publish(numeric,timestamptz)',
        'public.fn_tg_purchase_fx_quote(uuid)', 'public.fn_tg_bind_purchase_fx_quote(uuid,uuid)'
    ] LOOP
        v_function := v_signature::REGPROCEDURE;
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_function);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_function);
    END LOOP;
END;
$$;
COMMIT;
