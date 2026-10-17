-- TG email + query-password access. Additive, service-role-only migration.
-- Execute manually in the same Supabase project as the existing TG tables.
-- Requires the existing TG purchase/redemption and cancellation migrations.
-- Does not enable checkout, run a worker, settle, refund or resend any order.
BEGIN;

CREATE TABLE IF NOT EXISTS public.tg_order_query_buyers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_hash TEXT NOT NULL CHECK (contact_hash ~ '^[0-9a-f]{64}$'),
    password_hash TEXT NOT NULL CHECK (password_hash ~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$norm=v1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$'),
    group_no SMALLINT NOT NULL CHECK (group_no BETWEEN 1 AND 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (contact_hash, group_no)
);
COMMENT ON TABLE public.tg_order_query_buyers IS
    'TG order access only. HMAC email index, per-group salted scrypt hash; no plaintext email/password. Never used for pricing or fulfillment authorization.';
ALTER TABLE public.tg_order_query_buyers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tg_order_query_buyers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tg_order_query_buyers TO service_role;

ALTER TABLE public.tg_purchase_orders ADD COLUMN IF NOT EXISTS query_buyer_id UUID REFERENCES public.tg_order_query_buyers(id);
ALTER TABLE public.tg_redemption_orders ADD COLUMN IF NOT EXISTS query_buyer_id UUID REFERENCES public.tg_order_query_buyers(id);
CREATE INDEX IF NOT EXISTS tg_purchase_orders_query_buyer_idx
    ON public.tg_purchase_orders (query_buyer_id, created_at DESC, id DESC) WHERE query_buyer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tg_redemption_orders_query_buyer_idx
    ON public.tg_redemption_orders (query_buyer_id, created_at DESC, id DESC) WHERE query_buyer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_tg_upsert_query_buyer(
    p_contact_hash TEXT, p_password_hash TEXT, p_expected_groups INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_count INTEGER;
    v_id UUID;
BEGIN
    IF coalesce(p_contact_hash, '') !~ '^[0-9a-f]{64}$'
       OR coalesce(p_password_hash, '') !~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$norm=v1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$'
       OR p_expected_groups IS NULL OR p_expected_groups NOT BETWEEN 0 AND 4 THEN
        RAISE EXCEPTION 'tg_query_invalid_request';
    END IF;
    -- The API verifies all existing salted hashes. A concurrent insert forces
    -- another verification instead of allocating duplicate password groups.
    PERFORM pg_advisory_xact_lock(hashtextextended('tg-query-buyer:' || p_contact_hash, 0));
    SELECT count(*) INTO v_count FROM public.tg_order_query_buyers WHERE contact_hash = p_contact_hash;
    IF v_count <> p_expected_groups THEN RETURN jsonb_build_object('code', 'retry'); END IF;
    IF v_count >= 5 THEN RAISE EXCEPTION 'tg_query_group_limit'; END IF;
    INSERT INTO public.tg_order_query_buyers (contact_hash, password_hash, group_no)
    VALUES (p_contact_hash, p_password_hash, v_count + 1) RETURNING id INTO v_id;
    RETURN jsonb_build_object('buyer_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_bind_query_order(
    p_kind TEXT, p_order_no TEXT, p_status_token_hash TEXT, p_buyer_id UUID
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_id UUID;
    v_buyer UUID;
BEGIN
    IF p_buyer_id IS NULL OR coalesce(p_status_token_hash, '') !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
    PERFORM 1 FROM public.tg_order_query_buyers WHERE id = p_buyer_id FOR KEY SHARE;
    IF NOT FOUND THEN RETURN false; END IF;
    IF p_kind = 'purchase' THEN
        SELECT id, query_buyer_id INTO v_id, v_buyer FROM public.tg_purchase_orders
        WHERE order_no = p_order_no AND status_token_hash = p_status_token_hash FOR UPDATE;
        IF NOT FOUND THEN RETURN false; END IF;
        IF v_buyer IS NOT NULL AND v_buyer <> p_buyer_id THEN RAISE EXCEPTION 'tg_query_binding_conflict'; END IF;
        UPDATE public.tg_purchase_orders SET query_buyer_id = p_buyer_id WHERE id = v_id AND query_buyer_id IS NULL;
    ELSIF p_kind = 'redeem' THEN
        SELECT id, query_buyer_id INTO v_id, v_buyer FROM public.tg_redemption_orders
        WHERE order_no = p_order_no AND status_token_hash = p_status_token_hash FOR UPDATE;
        IF NOT FOUND THEN RETURN false; END IF;
        IF v_buyer IS NOT NULL AND v_buyer <> p_buyer_id THEN RAISE EXCEPTION 'tg_query_binding_conflict'; END IF;
        UPDATE public.tg_redemption_orders SET query_buyer_id = p_buyer_id WHERE id = v_id AND query_buyer_id IS NULL;
    ELSE RETURN false;
    END IF;
    RETURN true;
END;
$$;

-- Creation + ownership binding share a transaction. In particular, a replay
-- cannot attach an existing order to another buyer, and a failed bind rolls
-- back creation before the API can contact a payment provider.
CREATE OR REPLACE FUNCTION public.fn_tg_create_purchase_with_query(p_request JSONB, p_buyer_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result JSONB;
BEGIN
    PERFORM 1 FROM public.tg_order_query_buyers WHERE id = p_buyer_id FOR KEY SHARE;
    IF NOT FOUND OR jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'tg_query_invalid_request'; END IF;
    v_result := public.fn_tg_create_purchase(
        (p_request->>'p_quote_id')::UUID, p_request->>'p_expected_product_key', p_request->>'p_expected_username',
        (p_request->>'p_expected_total_minor')::BIGINT, (p_request->>'p_expected_price_version')::BIGINT,
        (p_request->>'p_expected_stars_quantity')::BIGINT,
        (p_request->>'p_status_token_hash')::CHAR(64), (p_request->>'p_idempotency_key_hash')::CHAR(64),
        p_request->>'p_payment_channel', p_request->>'p_payment_provider', p_request->>'p_payment_merchant_id');
    IF v_result->>'success' = 'true' AND NOT public.fn_tg_bind_query_order(
        'purchase', v_result->'order'->>'order_no', p_request->>'p_status_token_hash', p_buyer_id
    ) THEN RAISE EXCEPTION 'tg_query_bind_unconfirmed'; END IF;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_reserve_code_with_query(p_request JSONB, p_buyer_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result JSONB;
BEGIN
    PERFORM 1 FROM public.tg_order_query_buyers WHERE id = p_buyer_id FOR KEY SHARE;
    IF NOT FOUND OR jsonb_typeof(p_request) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'tg_query_invalid_request'; END IF;
    v_result := public.fn_tg_reserve_code(p_request->>'p_code_digest', p_request->>'p_username',
        (p_request->>'p_status_token_hash')::CHAR(64), (p_request->>'p_idempotency_key_hash')::CHAR(64));
    IF v_result->>'success' = 'true' AND NOT public.fn_tg_bind_query_order(
        'redeem', v_result->>'order_no', p_request->>'p_status_token_hash', p_buyer_id
    ) THEN RAISE EXCEPTION 'tg_query_bind_unconfirmed'; END IF;
    RETURN v_result;
END;
$$;

-- Internal hash is consumed only by the service's existing status/cancel RPCs;
-- it is never included in a browser response.
CREATE OR REPLACE FUNCTION public.fn_tg_query_order_token_hash(p_buyer_id UUID, p_kind TEXT, p_order_no TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_hash TEXT;
BEGIN
    IF p_kind = 'purchase' THEN
        SELECT status_token_hash INTO v_hash FROM public.tg_purchase_orders WHERE order_no = p_order_no AND query_buyer_id = p_buyer_id;
    ELSIF p_kind = 'redeem' THEN
        SELECT status_token_hash INTO v_hash FROM public.tg_redemption_orders WHERE order_no = p_order_no AND query_buyer_id = p_buyer_id;
    END IF;
    RETURN v_hash;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_query_orders(p_buyer_id UUID, p_kind TEXT, p_order_no TEXT, p_page INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_total BIGINT;
    v_orders JSONB := '[]'::JSONB;
    v_row RECORD;
    v_snapshot JSONB;
BEGIN
    IF p_buyer_id IS NULL OR p_page IS NULL OR p_page NOT BETWEEN 1 AND 10000
       OR coalesce(p_kind, '') NOT IN ('purchase', 'redeem') THEN RAISE EXCEPTION 'tg_query_invalid_request'; END IF;
    IF p_kind = 'purchase' THEN
        SELECT count(*) INTO v_total FROM public.tg_purchase_orders
        WHERE query_buyer_id = p_buyer_id AND (p_order_no IS NULL OR order_no = p_order_no);
        FOR v_row IN SELECT order_no, status_token_hash FROM public.tg_purchase_orders
            WHERE query_buyer_id = p_buyer_id AND (p_order_no IS NULL OR order_no = p_order_no)
            ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET (p_page - 1) * 20 LOOP
            v_snapshot := public.fn_tg_purchase_status(v_row.order_no, v_row.status_token_hash);
            IF v_snapshot->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'tg_query_snapshot_unconfirmed'; END IF;
            v_orders := v_orders || jsonb_build_array(v_snapshot->'order');
        END LOOP;
    ELSE
        SELECT count(*) INTO v_total FROM public.tg_redemption_orders
        WHERE query_buyer_id = p_buyer_id AND (p_order_no IS NULL OR order_no = p_order_no);
        FOR v_row IN SELECT order_no, status_token_hash FROM public.tg_redemption_orders
            WHERE query_buyer_id = p_buyer_id AND (p_order_no IS NULL OR order_no = p_order_no)
            ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET (p_page - 1) * 20 LOOP
            v_snapshot := public.fn_tg_order_status(v_row.order_no, v_row.status_token_hash);
            IF v_snapshot->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'tg_query_snapshot_unconfirmed'; END IF;
            v_orders := v_orders || jsonb_build_array(v_snapshot);
        END LOOP;
    END IF;
    RETURN jsonb_build_object('orders', v_orders, 'total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_order_query_contract()
RETURNS INTEGER LANGUAGE SQL SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE WHEN to_regclass('public.tg_order_query_buyers') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tg_purchase_orders' AND column_name = 'query_buyer_id')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tg_redemption_orders' AND column_name = 'query_buyer_id')
        AND to_regprocedure('public.fn_tg_create_purchase_with_query(jsonb,uuid)') IS NOT NULL
        AND to_regprocedure('public.fn_tg_reserve_code_with_query(jsonb,uuid)') IS NOT NULL
        AND to_regprocedure('public.fn_tg_bind_query_order(text,text,text,uuid)') IS NOT NULL
        AND to_regprocedure('public.fn_tg_upsert_query_buyer(text,text,integer)') IS NOT NULL
        AND to_regprocedure('public.fn_tg_query_orders(uuid,text,text,integer)') IS NOT NULL
        AND to_regprocedure('public.fn_tg_query_order_token_hash(uuid,text,text)') IS NOT NULL
    THEN 1 ELSE 0 END;
$$;

REVOKE ALL ON FUNCTION public.fn_tg_upsert_query_buyer(TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tg_bind_query_order(TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tg_create_purchase_with_query(JSONB, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tg_reserve_code_with_query(JSONB, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tg_query_order_token_hash(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tg_query_orders(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tg_order_query_contract() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_upsert_query_buyer(TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_tg_bind_query_order(TEXT, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_tg_create_purchase_with_query(JSONB, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_tg_reserve_code_with_query(JSONB, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_tg_query_order_token_hash(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_tg_query_orders(UUID, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_tg_order_query_contract() TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
