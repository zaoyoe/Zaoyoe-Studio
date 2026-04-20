BEGIN;

CREATE INDEX IF NOT EXISTS idx_prompt_comments_online_users_site_window
    ON public.prompt_comments(site, created_at DESC, user_id)
    WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_comment_likes_online_users_site_window
    ON public.comment_likes(site, created_at DESC, user_id)
    WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_events_online_users_site_window
    ON public.user_events(site, created_at DESC, user_id)
    WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_online_users_updated_at
    ON public.profiles(updated_at DESC);

DROP FUNCTION IF EXISTS public.get_online_user_count(INTEGER, VARCHAR);
DROP FUNCTION IF EXISTS public.get_online_user_count(INTEGER, TEXT);

CREATE OR REPLACE FUNCTION public.get_online_user_count(
    p_window_minutes INTEGER DEFAULT 5,
    p_site VARCHAR DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_window_minutes INTEGER;
    v_window_start TIMESTAMPTZ;
    v_site TEXT;
    v_count INTEGER := 0;
BEGIN
    IF auth.uid() IS NULL OR NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    v_window_minutes := LEAST(GREATEST(COALESCE(p_window_minutes, 5), 1), 1440);
    v_window_start := NOW() - make_interval(mins => v_window_minutes);
    v_site := LOWER(BTRIM(COALESCE(p_site::TEXT, '')));

    IF v_site IN ('', 'all', '*') THEN
        v_site := NULL;
    ELSIF v_site NOT IN ('cn', 'intl') THEN
        RETURN 0;
    END IF;

    WITH online_user_ids AS (
        SELECT pc.user_id
        FROM public.prompt_comments pc
        WHERE pc.user_id IS NOT NULL
          AND pc.created_at >= v_window_start
          AND (v_site IS NULL OR pc.site = v_site)

        UNION

        SELECT cl.user_id
        FROM public.comment_likes cl
        WHERE cl.user_id IS NOT NULL
          AND cl.created_at >= v_window_start
          AND (v_site IS NULL OR cl.site = v_site)

        UNION

        SELECT ue.user_id
        FROM public.user_events ue
        WHERE ue.user_id IS NOT NULL
          AND ue.created_at >= v_window_start
          AND (v_site IS NULL OR ue.site = v_site)
    )
    SELECT COUNT(*)::INTEGER
    INTO v_count
    FROM online_user_ids;

    IF v_count = 0 AND v_site IS NULL THEN
        SELECT COUNT(*)::INTEGER
        INTO v_count
        FROM public.profiles p
        WHERE p.updated_at >= v_window_start;
    END IF;

    RETURN COALESCE(v_count, 0);
END;
$$;

COMMENT ON FUNCTION public.get_online_user_count(INTEGER, VARCHAR)
    IS 'Admin analytics online-user count from recent comments, likes, and business events; all-sites only falls back to profiles.updated_at when no activity rows exist.';

GRANT EXECUTE ON FUNCTION public.get_online_user_count(INTEGER, VARCHAR) TO authenticated;

COMMIT;
