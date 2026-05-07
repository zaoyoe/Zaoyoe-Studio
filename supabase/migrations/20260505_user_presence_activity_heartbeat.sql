-- Persist realtime user-presence heartbeats so admin user activity is accurate.

CREATE TABLE IF NOT EXISTS public.engagement_user_activity (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_page_id TEXT,
    site TEXT DEFAULT 'cn',
    source_module TEXT DEFAULT 'engagement.feed',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_engagement_user_activity_last_active
    ON public.engagement_user_activity (last_active_at DESC);

CREATE INDEX IF NOT EXISTS idx_engagement_user_activity_site_page
    ON public.engagement_user_activity (site, last_page_id, last_active_at DESC);

CREATE INDEX IF NOT EXISTS idx_engagement_user_activity_user_site
    ON public.engagement_user_activity (user_id, site, last_active_at DESC);

ALTER TABLE public.engagement_user_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view engagement user activity" ON public.engagement_user_activity;
CREATE POLICY "Admins can view engagement user activity"
    ON public.engagement_user_activity FOR SELECT
    USING (public.is_admin());

DROP POLICY IF EXISTS "Users can view own engagement activity" ON public.engagement_user_activity;
CREATE POLICY "Users can view own engagement activity"
    ON public.engagement_user_activity FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own engagement activity" ON public.engagement_user_activity;
CREATE POLICY "Users can insert own engagement activity"
    ON public.engagement_user_activity FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own engagement activity" ON public.engagement_user_activity;
CREATE POLICY "Users can update own engagement activity"
    ON public.engagement_user_activity FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_engagement_user_activity_updated_at ON public.engagement_user_activity;
CREATE OR REPLACE FUNCTION public.touch_engagement_user_activity_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_engagement_user_activity_updated_at
    BEFORE UPDATE ON public.engagement_user_activity
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_engagement_user_activity_updated_at();

CREATE OR REPLACE FUNCTION public.fn_record_user_activity_heartbeat(
    p_page_id TEXT DEFAULT 'home',
    p_site TEXT DEFAULT 'cn',
    p_source_module TEXT DEFAULT 'presence.heartbeat'
)
RETURNS TABLE (
    ok BOOLEAN,
    last_active_at TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_now TIMESTAMPTZ := NOW();
    v_page_id TEXT := LEFT(COALESCE(NULLIF(BTRIM(p_page_id), ''), 'home'), 80);
    v_site TEXT := LEFT(COALESCE(NULLIF(BTRIM(p_site), ''), 'cn'), 20);
    v_source_module TEXT := LEFT(COALESCE(NULLIF(BTRIM(p_source_module), ''), 'presence.heartbeat'), 80);
    v_last_active_at TIMESTAMPTZ;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::TIMESTAMPTZ;
        RETURN;
    END IF;

    INSERT INTO public.engagement_user_activity (
        user_id,
        last_active_at,
        last_page_id,
        site,
        source_module,
        updated_at
    )
    VALUES (
        v_user_id,
        v_now,
        v_page_id,
        v_site,
        v_source_module,
        v_now
    )
    ON CONFLICT (user_id) DO UPDATE
    SET
        last_active_at = GREATEST(public.engagement_user_activity.last_active_at, EXCLUDED.last_active_at),
        last_page_id = EXCLUDED.last_page_id,
        site = EXCLUDED.site,
        source_module = EXCLUDED.source_module,
        updated_at = v_now
    RETURNING public.engagement_user_activity.last_active_at INTO v_last_active_at;

    RETURN QUERY SELECT TRUE, v_last_active_at;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.fn_record_user_activity_heartbeat(TEXT, TEXT, TEXT) TO authenticated;

DROP FUNCTION IF EXISTS public.get_admin_users();

CREATE OR REPLACE FUNCTION public.get_admin_users()
RETURNS TABLE (
  out_id uuid,
  out_email varchar,
  out_created_at timestamptz,
  out_last_sign_in_at timestamptz,
  out_username text,
  out_avatar_url text,
  out_last_active_at timestamptz
)
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_roles ar WHERE ar.user_id = auth.uid() AND ar.role_name = 'admin'
    UNION
    SELECT 1 FROM public.profiles pf WHERE pf.id = auth.uid() AND pf.email IN ('fjivvid@163.com', 'zaoyoe@gmail.com', 'ruihuashi620@gmail.com', 'wangyongchao802@gmail.com', '1012162759@qq.com')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH latest_activity AS (
    SELECT eua.user_id AS a_user_id, MAX(eua.last_active_at) AS last_active_at
    FROM public.engagement_user_activity eua
    GROUP BY eua.user_id
  )
  SELECT
    au.id AS out_id,
    au.email::varchar AS out_email,
    au.created_at AS out_created_at,
    au.last_sign_in_at AS out_last_sign_in_at,
    p.username AS out_username,
    p.avatar_url AS out_avatar_url,
    la.last_active_at AS out_last_active_at
  FROM auth.users au
  LEFT JOIN public.profiles p ON au.id = p.id
  LEFT JOIN latest_activity la ON au.id = la.a_user_id
  ORDER BY la.last_active_at DESC NULLS LAST, au.created_at DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql;
