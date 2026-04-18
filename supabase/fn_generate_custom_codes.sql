-- Site-aware helper for custom redemption code generation
-- Aligned with 2026-03-22 hardened payment/redemption entrypoints

CREATE OR REPLACE FUNCTION public.fn_generate_custom_codes(
    p_batch_name TEXT,
    p_points_amount NUMERIC(12,2),
    p_count INTEGER,
    p_channel TEXT DEFAULT 'manual',
    p_expires_at TIMESTAMPTZ DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS TABLE(code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_batch_id UUID;
    v_code TEXT;
    i INTEGER;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Admin only';
    END IF;

    IF COALESCE(BTRIM(p_batch_name), '') = '' THEN
        RAISE EXCEPTION 'batch name is required';
    END IF;

    IF p_points_amount <= 0 THEN
        RAISE EXCEPTION 'Points amount must be positive';
    END IF;

    IF p_count <= 0 OR p_count > 1000 THEN
        RAISE EXCEPTION 'Count must be between 1 and 1000';
    END IF;

    INSERT INTO public.redemption_batches (
        name,
        package_id,
        channel,
        total_count,
        used_count,
        expires_at,
        custom_points_amount,
        site,
        created_by
    ) VALUES (
        p_batch_name,
        NULL,
        COALESCE(NULLIF(BTRIM(p_channel), ''), 'manual'),
        p_count,
        0,
        p_expires_at,
        p_points_amount,
        COALESCE(NULLIF(BTRIM(p_site), ''), 'cn'),
        auth.uid()
    ) RETURNING id INTO v_batch_id;

    FOR i IN 1..p_count LOOP
        v_code := 'ZY-'
            || upper(substring(md5(random()::text) from 1 for 4))
            || '-'
            || upper(substring(md5(random()::text) from 1 for 4))
            || '-'
            || upper(substring(md5(random()::text) from 1 for 4));

        INSERT INTO public.redemption_codes (
            batch_id,
            code,
            points_amount,
            status,
            expires_at,
            site
        ) VALUES (
            v_batch_id,
            v_code,
            p_points_amount,
            'pending',
            p_expires_at,
            COALESCE(NULLIF(BTRIM(p_site), ''), 'cn')
        );

        RETURN QUERY SELECT v_code;
    END LOOP;

    RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_generate_custom_codes(
    p_batch_name TEXT,
    p_points_amount NUMERIC(12,2),
    p_count INTEGER,
    p_channel TEXT DEFAULT 'manual',
    p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(code TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    SELECT generated.code
    FROM public.fn_generate_custom_codes(
        p_batch_name,
        p_points_amount,
        p_count,
        p_channel,
        p_expires_at,
        'cn'
    ) AS generated(code);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_generate_custom_codes(TEXT, NUMERIC, INTEGER, TEXT, TIMESTAMPTZ, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_generate_custom_codes(TEXT, NUMERIC, INTEGER, TEXT, TIMESTAMPTZ, VARCHAR) TO authenticated;

REVOKE ALL ON FUNCTION public.fn_generate_custom_codes(TEXT, NUMERIC, INTEGER, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_generate_custom_codes(TEXT, NUMERIC, INTEGER, TEXT, TIMESTAMPTZ) TO authenticated;
