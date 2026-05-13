BEGIN;

ALTER TABLE IF EXISTS public.engagement_segments
    ADD COLUMN IF NOT EXISTS site TEXT NOT NULL DEFAULT 'all';

ALTER TABLE IF EXISTS public.engagement_segments
    DROP CONSTRAINT IF EXISTS engagement_segments_site_check;

ALTER TABLE IF EXISTS public.engagement_segments
    ADD CONSTRAINT engagement_segments_site_check
    CHECK (site IN ('all', 'cn', 'intl'));

ALTER TABLE IF EXISTS public.engagement_segments
    DROP CONSTRAINT IF EXISTS engagement_segments_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_segments_site_key
    ON public.engagement_segments (site, key);

CREATE INDEX IF NOT EXISTS idx_engagement_segments_site_enabled
    ON public.engagement_segments (site, enabled, updated_at DESC);

ALTER TABLE IF EXISTS public.engagement_user_activity
    DROP CONSTRAINT IF EXISTS engagement_user_activity_pkey;

UPDATE public.engagement_user_activity
SET site = 'cn'
WHERE site IS NULL OR BTRIM(site) = '';

ALTER TABLE IF EXISTS public.engagement_user_activity
    ALTER COLUMN site SET NOT NULL;

ALTER TABLE IF EXISTS public.engagement_user_activity
    ADD CONSTRAINT engagement_user_activity_pkey
    PRIMARY KEY (user_id, site);

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
    ON CONFLICT (user_id, site) DO UPDATE
    SET
        last_active_at = GREATEST(public.engagement_user_activity.last_active_at, EXCLUDED.last_active_at),
        last_page_id = EXCLUDED.last_page_id,
        source_module = EXCLUDED.source_module,
        updated_at = v_now
    RETURNING public.engagement_user_activity.last_active_at INTO v_last_active_at;

    RETURN QUERY SELECT TRUE, v_last_active_at;
END;
$$ LANGUAGE plpgsql;

UPDATE public.system_config
SET
    config_value = jsonb_build_object(
        '__site_scoped', true,
        'default', config_value,
        'sites', '{}'::jsonb
    ),
    updated_at = NOW()
WHERE config_key IN (
    'engagement_asset_style_center',
    'engagement_support_entry_center',
    'engagement_page_scenes',
    'engagement_external_embed_policy',
    'engagement_user_tag_center'
)
AND NOT (COALESCE(config_value, '{}'::jsonb) ? '__site_scoped');

COMMIT;
