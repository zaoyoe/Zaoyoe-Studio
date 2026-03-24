-- ============================================
-- Persistent Rate Limits
-- Cross-instance rate limiting for payment and auth surfaces
-- ============================================

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
    bucket_key TEXT PRIMARY KEY,
    hit_count INTEGER NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    reset_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_reset_at
    ON public.rate_limit_buckets(reset_at);

ALTER TABLE IF EXISTS public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rate_limit_buckets FROM PUBLIC;
REVOKE ALL ON public.rate_limit_buckets FROM anon;
REVOKE ALL ON public.rate_limit_buckets FROM authenticated;

CREATE OR REPLACE FUNCTION public.prune_rate_limit_buckets(
    p_before TIMESTAMPTZ DEFAULT timezone('utc', now()) - INTERVAL '24 hours',
    p_max_rows INTEGER DEFAULT 200
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deleted INTEGER := 0;
BEGIN
    WITH stale AS (
        SELECT bucket_key
        FROM public.rate_limit_buckets
        WHERE reset_at < COALESCE(p_before, timezone('utc', now()) - INTERVAL '24 hours')
        ORDER BY reset_at ASC
        LIMIT GREATEST(1, COALESCE(p_max_rows, 200))
    ),
    deleted AS (
        DELETE FROM public.rate_limit_buckets
        WHERE bucket_key IN (SELECT bucket_key FROM stale)
        RETURNING 1
    )
    SELECT COUNT(*)
    INTO v_deleted
    FROM deleted;

    RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.take_rate_limit_token(
    p_key TEXT,
    p_limit INTEGER DEFAULT 60,
    p_window_ms INTEGER DEFAULT 60000,
    p_now TIMESTAMPTZ DEFAULT timezone('utc', now())
)
RETURNS TABLE (
    allowed BOOLEAN,
    limit_value INTEGER,
    remaining INTEGER,
    reset_at TIMESTAMPTZ,
    retry_after_seconds INTEGER,
    hit_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    safe_key TEXT := BTRIM(COALESCE(p_key, ''));
    safe_limit INTEGER := GREATEST(1, COALESCE(p_limit, 60));
    safe_window_ms INTEGER := GREATEST(1000, COALESCE(p_window_ms, 60000));
    v_now TIMESTAMPTZ := COALESCE(p_now, timezone('utc', now()));
    v_window INTERVAL := (safe_window_ms::TEXT || ' milliseconds')::INTERVAL;
    v_entry public.rate_limit_buckets%ROWTYPE;
    v_next_count INTEGER := 0;
BEGIN
    IF safe_key = '' THEN
        RETURN QUERY
        SELECT
            TRUE,
            safe_limit,
            GREATEST(0, safe_limit - 1),
            v_now + v_window,
            GREATEST(1, CEIL(EXTRACT(EPOCH FROM v_window)))::INTEGER,
            1;
        RETURN;
    END IF;

    IF MOD(ABS(hashtext(safe_key)), 128) = 0 THEN
        PERFORM public.prune_rate_limit_buckets(v_now - INTERVAL '24 hours', 200);
    END IF;

    LOOP
        SELECT *
        INTO v_entry
        FROM public.rate_limit_buckets
        WHERE bucket_key = safe_key
        FOR UPDATE;

        IF NOT FOUND THEN
            BEGIN
                INSERT INTO public.rate_limit_buckets (
                    bucket_key,
                    hit_count,
                    window_started_at,
                    reset_at,
                    updated_at
                ) VALUES (
                    safe_key,
                    1,
                    v_now,
                    v_now + v_window,
                    v_now
                );

                RETURN QUERY
                SELECT
                    TRUE,
                    safe_limit,
                    GREATEST(0, safe_limit - 1),
                    v_now + v_window,
                    GREATEST(1, CEIL(EXTRACT(EPOCH FROM v_window)))::INTEGER,
                    1;
                RETURN;
            EXCEPTION
                WHEN unique_violation THEN
                    NULL;
            END;
        ELSIF v_entry.reset_at <= v_now THEN
            UPDATE public.rate_limit_buckets
            SET
                hit_count = 1,
                window_started_at = v_now,
                reset_at = v_now + v_window,
                updated_at = v_now
            WHERE bucket_key = safe_key;

            RETURN QUERY
            SELECT
                TRUE,
                safe_limit,
                GREATEST(0, safe_limit - 1),
                v_now + v_window,
                GREATEST(1, CEIL(EXTRACT(EPOCH FROM v_window)))::INTEGER,
                1;
            RETURN;
        ELSIF v_entry.hit_count >= safe_limit THEN
            UPDATE public.rate_limit_buckets
            SET updated_at = v_now
            WHERE bucket_key = safe_key;

            RETURN QUERY
            SELECT
                FALSE,
                safe_limit,
                0,
                v_entry.reset_at,
                GREATEST(1, CEIL(EXTRACT(EPOCH FROM GREATEST(v_entry.reset_at - v_now, INTERVAL '0 seconds'))))::INTEGER,
                v_entry.hit_count;
            RETURN;
        ELSE
            v_next_count := v_entry.hit_count + 1;

            UPDATE public.rate_limit_buckets
            SET
                hit_count = v_next_count,
                updated_at = v_now
            WHERE bucket_key = safe_key;

            RETURN QUERY
            SELECT
                TRUE,
                safe_limit,
                GREATEST(0, safe_limit - v_next_count),
                v_entry.reset_at,
                GREATEST(1, CEIL(EXTRACT(EPOCH FROM GREATEST(v_entry.reset_at - v_now, INTERVAL '0 seconds'))))::INTEGER,
                v_next_count;
            RETURN;
        END IF;
    END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_rate_limit_buckets(TIMESTAMPTZ, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_rate_limit_buckets(TIMESTAMPTZ, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.take_rate_limit_token(TEXT, INTEGER, INTEGER, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.take_rate_limit_token(TEXT, INTEGER, INTEGER, TIMESTAMPTZ) TO service_role;
