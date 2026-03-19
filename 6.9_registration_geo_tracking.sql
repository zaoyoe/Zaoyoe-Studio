-- ============================================
-- 注册 IP / 登录地理信息追踪热修复
-- 目标：
-- 1. 新注册用户稳定记录 registration_ip
-- 2. 登录/注册时自动写入 country / region / city
-- 3. 老用户尽量用首个登录 IP 回填注册所在地
-- ============================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS registration_ip TEXT;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS registration_geo_info JSONB;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS registration_country TEXT;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS registration_region TEXT;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS registration_city TEXT;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS last_login_ip TEXT;

COMMENT ON COLUMN public.profiles.registration_ip IS '注册时采集到的客户端 IP';
COMMENT ON COLUMN public.profiles.registration_geo_info IS '注册地理信息 JSON {country, region, city}';
COMMENT ON COLUMN public.profiles.registration_country IS '注册所在地国家/地区';
COMMENT ON COLUMN public.profiles.registration_region IS '注册所在地省/州';
COMMENT ON COLUMN public.profiles.registration_city IS '注册所在地城市';

CREATE TABLE IF NOT EXISTS public.user_login_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    ip_address INET NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_login_history
    ADD COLUMN IF NOT EXISTS geo_info JSONB DEFAULT NULL;

ALTER TABLE public.user_login_history
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn';

COMMENT ON COLUMN public.user_login_history.geo_info IS 'IP 地理信息 {country, region, city}';

ALTER TABLE public.user_login_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own login history" ON public.user_login_history;
CREATE POLICY "Users can insert own login history"
ON public.user_login_history FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view login history" ON public.user_login_history;
CREATE POLICY "Admins can view login history"
ON public.user_login_history FOR SELECT
USING (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_profiles_registration_ip
    ON public.profiles(registration_ip)
    WHERE registration_ip IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_login_history_user_created_at
    ON public.user_login_history(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_login_history_user_ip
    ON public.user_login_history(user_id, ip_address);

CREATE OR REPLACE FUNCTION public.fn_upsert_user_auth_origin(
    p_user_id UUID,
    p_ip TEXT DEFAULT NULL,
    p_geo_info JSONB DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_site TEXT DEFAULT 'cn',
    p_context TEXT DEFAULT 'login'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ip TEXT := NULLIF(BTRIM(p_ip), '');
    v_geo_info JSONB := CASE
        WHEN jsonb_typeof(p_geo_info) = 'object' THEN p_geo_info
        ELSE NULL
    END;
    v_country TEXT := NULLIF(BTRIM(COALESCE(v_geo_info->>'country', '')), '');
    v_region TEXT := NULLIF(BTRIM(COALESCE(v_geo_info->>'region', v_geo_info->>'province', '')), '');
    v_city TEXT := NULLIF(BTRIM(COALESCE(v_geo_info->>'city', '')), '');
    v_site TEXT := COALESCE(NULLIF(BTRIM(p_site), ''), 'cn');
    v_context TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_context), ''), 'login'));
    v_registration_ip TEXT;
    v_existing_login RECORD;
BEGIN
    IF auth.uid() IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'Permission denied';
    END IF;

    IF v_ip IS NULL AND v_geo_info IS NULL THEN
        RETURN jsonb_build_object(
            'success', FALSE,
            'message', 'missing auth origin payload'
        );
    END IF;

    UPDATE public.profiles
    SET last_login_ip = COALESCE(v_ip, last_login_ip)
    WHERE id = p_user_id;

    UPDATE public.profiles
    SET
        registration_ip = CASE
            WHEN (registration_ip IS NULL OR BTRIM(registration_ip) = '') AND v_ip IS NOT NULL THEN v_ip
            ELSE registration_ip
        END,
        registration_geo_info = CASE
            WHEN (registration_geo_info IS NULL OR registration_geo_info = '{}'::jsonb)
                 AND v_geo_info IS NOT NULL
                 AND (
                    v_context = 'register'
                    OR registration_ip IS NULL
                    OR BTRIM(registration_ip) = ''
                    OR registration_ip = v_ip
                 )
                THEN v_geo_info
            ELSE registration_geo_info
        END,
        registration_country = CASE
            WHEN COALESCE(BTRIM(registration_country), '') = ''
                 AND v_country IS NOT NULL
                 AND (
                    v_context = 'register'
                    OR registration_ip IS NULL
                    OR BTRIM(registration_ip) = ''
                    OR registration_ip = v_ip
                 )
                THEN v_country
            ELSE registration_country
        END,
        registration_region = CASE
            WHEN COALESCE(BTRIM(registration_region), '') = ''
                 AND v_region IS NOT NULL
                 AND (
                    v_context = 'register'
                    OR registration_ip IS NULL
                    OR BTRIM(registration_ip) = ''
                    OR registration_ip = v_ip
                 )
                THEN v_region
            ELSE registration_region
        END,
        registration_city = CASE
            WHEN COALESCE(BTRIM(registration_city), '') = ''
                 AND v_city IS NOT NULL
                 AND (
                    v_context = 'register'
                    OR registration_ip IS NULL
                    OR BTRIM(registration_ip) = ''
                    OR registration_ip = v_ip
                 )
                THEN v_city
            ELSE registration_city
        END
    WHERE id = p_user_id;

    IF v_ip IS NOT NULL THEN
        SELECT
            ulh.id,
            ulh.created_at,
            ulh.geo_info
        INTO v_existing_login
        FROM public.user_login_history ulh
        WHERE ulh.user_id = p_user_id
          AND ulh.ip_address = v_ip::INET
          AND COALESCE(ulh.user_agent, '') = COALESCE(p_user_agent, '')
        ORDER BY ulh.created_at DESC
        LIMIT 1;

        IF v_existing_login.id IS NULL OR v_existing_login.created_at < NOW() - INTERVAL '15 minutes' THEN
            INSERT INTO public.user_login_history (
                user_id,
                ip_address,
                user_agent,
                geo_info,
                site
            ) VALUES (
                p_user_id,
                v_ip::INET,
                p_user_agent,
                v_geo_info,
                v_site
            );
        ELSIF v_geo_info IS NOT NULL AND (v_existing_login.geo_info IS NULL OR v_existing_login.geo_info = '{}'::jsonb) THEN
            UPDATE public.user_login_history
            SET
                geo_info = v_geo_info,
                user_agent = COALESCE(user_agent, p_user_agent),
                site = COALESCE(NULLIF(BTRIM(site), ''), v_site)
            WHERE id = v_existing_login.id;
        END IF;
    END IF;

    SELECT NULLIF(BTRIM(registration_ip), '')
    INTO v_registration_ip
    FROM public.profiles
    WHERE id = p_user_id;

    UPDATE public.profiles p
    SET
        registration_ip = COALESCE(NULLIF(BTRIM(p.registration_ip), ''), candidate.ip_text),
        registration_geo_info = CASE
            WHEN (p.registration_geo_info IS NULL OR p.registration_geo_info = '{}'::jsonb)
                 AND candidate.geo_info IS NOT NULL
                THEN candidate.geo_info
            ELSE p.registration_geo_info
        END,
        registration_country = COALESCE(
            NULLIF(BTRIM(p.registration_country), ''),
            NULLIF(BTRIM(COALESCE(candidate.geo_info->>'country', '')), '')
        ),
        registration_region = COALESCE(
            NULLIF(BTRIM(p.registration_region), ''),
            NULLIF(BTRIM(COALESCE(candidate.geo_info->>'region', candidate.geo_info->>'province', '')), '')
        ),
        registration_city = COALESCE(
            NULLIF(BTRIM(p.registration_city), ''),
            NULLIF(BTRIM(COALESCE(candidate.geo_info->>'city', '')), '')
        )
    FROM LATERAL (
        SELECT
            ulh.ip_address::TEXT AS ip_text,
            ulh.geo_info
        FROM public.user_login_history ulh
        WHERE ulh.user_id = p_user_id
        ORDER BY
            CASE
                WHEN v_registration_ip IS NOT NULL AND ulh.ip_address::TEXT = v_registration_ip THEN 0
                WHEN v_ip IS NOT NULL AND ulh.ip_address = v_ip::INET THEN 1
                ELSE 2
            END,
            ulh.created_at ASC
        LIMIT 1
    ) AS candidate
    WHERE p.id = p_user_id
      AND (
        p.registration_ip IS NULL OR BTRIM(p.registration_ip) = ''
        OR p.registration_geo_info IS NULL OR p.registration_geo_info = '{}'::jsonb
        OR p.registration_country IS NULL OR BTRIM(p.registration_country) = ''
        OR p.registration_region IS NULL OR BTRIM(p.registration_region) = ''
        OR p.registration_city IS NULL OR BTRIM(p.registration_city) = ''
      );

    RETURN (
        SELECT jsonb_build_object(
            'success', TRUE,
            'context', v_context,
            'registration_ip', registration_ip,
            'country', registration_country,
            'region', registration_region,
            'city', registration_city
        )
        FROM public.profiles
        WHERE id = p_user_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_upsert_user_auth_origin(UUID, TEXT, JSONB, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_upsert_user_auth_origin(UUID, TEXT, JSONB, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_upsert_user_auth_origin(UUID, TEXT, JSONB, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_login_ip(
    p_user_id UUID,
    p_ip TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.fn_upsert_user_auth_origin(
        p_user_id,
        p_ip,
        NULL,
        NULL,
        'cn',
        'login'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_backfill_registration_origin(
    p_limit INTEGER DEFAULT 5000
)
RETURNS TABLE (
    user_id UUID,
    registration_ip TEXT,
    registration_country TEXT,
    registration_region TEXT,
    registration_city TEXT,
    source TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH candidates AS (
        SELECT
            p.id AS target_user_id,
            COALESCE(NULLIF(BTRIM(p.registration_ip), ''), matched_login.ip_text, first_login.ip_text) AS resolved_ip,
            COALESCE(
                p.registration_geo_info,
                matched_login.geo_info,
                first_login.geo_info
            ) AS resolved_geo,
            COALESCE(
                NULLIF(BTRIM(p.registration_country), ''),
                NULLIF(BTRIM(COALESCE(matched_login.geo_info->>'country', first_login.geo_info->>'country', '')), '')
            ) AS resolved_country,
            COALESCE(
                NULLIF(BTRIM(p.registration_region), ''),
                NULLIF(BTRIM(COALESCE(matched_login.geo_info->>'region', matched_login.geo_info->>'province', first_login.geo_info->>'region', first_login.geo_info->>'province', '')), '')
            ) AS resolved_region,
            COALESCE(
                NULLIF(BTRIM(p.registration_city), ''),
                NULLIF(BTRIM(COALESCE(matched_login.geo_info->>'city', first_login.geo_info->>'city', '')), '')
            ) AS resolved_city,
            CASE
                WHEN NULLIF(BTRIM(p.registration_ip), '') IS NULL AND first_login.ip_text IS NOT NULL THEN 'first_login_ip'
                WHEN (p.registration_geo_info IS NULL OR p.registration_geo_info = '{}'::jsonb) AND matched_login.geo_info IS NOT NULL THEN 'matched_registration_ip'
                WHEN (p.registration_geo_info IS NULL OR p.registration_geo_info = '{}'::jsonb) AND first_login.geo_info IS NOT NULL THEN 'first_login_geo'
                ELSE 'history_backfill'
            END AS resolved_source,
            COALESCE(first_login.created_at, matched_login.created_at) AS first_seen_at
        FROM public.profiles p
        LEFT JOIN LATERAL (
            SELECT
                ulh.ip_address::TEXT AS ip_text,
                ulh.geo_info,
                ulh.created_at
            FROM public.user_login_history ulh
            WHERE ulh.user_id = p.id
              AND NULLIF(BTRIM(p.registration_ip), '') IS NOT NULL
              AND ulh.ip_address::TEXT = NULLIF(BTRIM(p.registration_ip), '')
            ORDER BY ulh.created_at ASC
            LIMIT 1
        ) AS matched_login ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                ulh.ip_address::TEXT AS ip_text,
                ulh.geo_info,
                ulh.created_at
            FROM public.user_login_history ulh
            WHERE ulh.user_id = p.id
            ORDER BY ulh.created_at ASC
            LIMIT 1
        ) AS first_login ON TRUE
        WHERE (
            p.registration_ip IS NULL OR BTRIM(p.registration_ip) = ''
            OR p.registration_geo_info IS NULL OR p.registration_geo_info = '{}'::jsonb
            OR p.registration_country IS NULL OR BTRIM(p.registration_country) = ''
            OR p.registration_region IS NULL OR BTRIM(p.registration_region) = ''
            OR p.registration_city IS NULL OR BTRIM(p.registration_city) = ''
        )
          AND (matched_login.ip_text IS NOT NULL OR first_login.ip_text IS NOT NULL)
        ORDER BY first_seen_at ASC NULLS LAST
        LIMIT GREATEST(COALESCE(p_limit, 5000), 0)
    ),
    updated AS (
        UPDATE public.profiles p
        SET
            registration_ip = COALESCE(NULLIF(BTRIM(p.registration_ip), ''), c.resolved_ip),
            registration_geo_info = CASE
                WHEN (p.registration_geo_info IS NULL OR p.registration_geo_info = '{}'::jsonb)
                     AND c.resolved_geo IS NOT NULL
                    THEN c.resolved_geo
                ELSE p.registration_geo_info
            END,
            registration_country = COALESCE(NULLIF(BTRIM(p.registration_country), ''), c.resolved_country),
            registration_region = COALESCE(NULLIF(BTRIM(p.registration_region), ''), c.resolved_region),
            registration_city = COALESCE(NULLIF(BTRIM(p.registration_city), ''), c.resolved_city)
        FROM candidates c
        WHERE p.id = c.target_user_id
        RETURNING
            p.id,
            p.registration_ip::TEXT,
            p.registration_country::TEXT,
            p.registration_region::TEXT,
            p.registration_city::TEXT,
            c.resolved_source::TEXT
    )
    SELECT
        updated.id,
        updated.registration_ip::TEXT,
        updated.registration_country::TEXT,
        updated.registration_region::TEXT,
        updated.registration_city::TEXT,
        updated.resolved_source::TEXT
    FROM updated;
END;
$$;

SELECT *
FROM public.fn_backfill_registration_origin(5000);
