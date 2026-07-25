BEGIN;

ALTER TABLE public.user_events
    ADD COLUMN IF NOT EXISTS site VARCHAR(10);

CREATE TABLE IF NOT EXISTS public.prompt_favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    prompt_id TEXT NOT NULL,
    site VARCHAR(10) NOT NULL DEFAULT 'cn' CHECK (site IN ('cn', 'intl')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, prompt_id, site)
);

CREATE INDEX IF NOT EXISTS idx_prompt_favorites_prompt_site
    ON public.prompt_favorites(prompt_id, site);

ALTER TABLE public.prompt_favorites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.prompt_favorites FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.prompt_favorites TO authenticated;
GRANT ALL ON TABLE public.prompt_favorites TO service_role;

DROP POLICY IF EXISTS "Users can read own prompt favorites" ON public.prompt_favorites;
CREATE POLICY "Users can read own prompt favorites"
    ON public.prompt_favorites
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own prompt favorites" ON public.prompt_favorites;
CREATE POLICY "Users can create own prompt favorites"
    ON public.prompt_favorites
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own prompt favorites" ON public.prompt_favorites;
CREATE POLICY "Users can delete own prompt favorites"
    ON public.prompt_favorites
    FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own prompt favorites" ON public.prompt_favorites;
CREATE POLICY "Users can update own prompt favorites"
    ON public.prompt_favorites
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.prompt_hotness_metrics (
    prompt_id TEXT NOT NULL,
    site VARCHAR(10) NOT NULL DEFAULT 'cn' CHECK (site IN ('cn', 'intl')),
    favorite_count BIGINT NOT NULL DEFAULT 0 CHECK (favorite_count >= 0),
    comment_count BIGINT NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
    click_count BIGINT NOT NULL DEFAULT 0 CHECK (click_count >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (prompt_id, site)
);

ALTER TABLE public.prompt_hotness_metrics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.prompt_hotness_metrics FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.prompt_hotness_metrics TO service_role;

CREATE TABLE IF NOT EXISTS public.prompt_card_clicks (
    prompt_id TEXT NOT NULL,
    site VARCHAR(10) NOT NULL DEFAULT 'cn' CHECK (site IN ('cn', 'intl')),
    session_key VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (prompt_id, site, session_key)
);

CREATE INDEX IF NOT EXISTS idx_prompt_card_clicks_created_at
    ON public.prompt_card_clicks(created_at DESC);

ALTER TABLE public.prompt_card_clicks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.prompt_card_clicks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.prompt_card_clicks TO service_role;

WITH metric_events AS (
    SELECT
        pf.prompt_id,
        pf.site,
        COUNT(*)::BIGINT AS favorite_count,
        0::BIGINT AS comment_count,
        0::BIGINT AS click_count
    FROM public.prompt_favorites pf
    GROUP BY pf.prompt_id, pf.site

    UNION ALL

    SELECT
        pc.prompt_id::TEXT AS prompt_id,
        CASE WHEN LOWER(BTRIM(COALESCE(pc.site, 'cn'))) = 'intl' THEN 'intl' ELSE 'cn' END AS site,
        0::BIGINT AS favorite_count,
        COUNT(*)::BIGINT AS comment_count,
        0::BIGINT AS click_count
    FROM public.prompt_comments pc
    GROUP BY pc.prompt_id::TEXT, 2

    UNION ALL

    SELECT
        COALESCE(
            NULLIF(ue.event_data->>'entity_id', ''),
            NULLIF(ue.event_data->'metadata'->>'prompt_id', '')
        ) AS prompt_id,
        CASE
            WHEN LOWER(BTRIM(COALESCE(NULLIF(ue.site, ''), NULLIF(ue.event_data->>'site', ''), 'cn'))) = 'intl'
                THEN 'intl'
            ELSE 'cn'
        END AS site,
        0::BIGINT AS favorite_count,
        0::BIGINT AS comment_count,
        COUNT(*)::BIGINT AS click_count
    FROM public.user_events ue
    WHERE ue.event_name = 'prompt_view'
      AND COALESCE(
            NULLIF(ue.event_data->>'entity_id', ''),
            NULLIF(ue.event_data->'metadata'->>'prompt_id', '')
          ) IS NOT NULL
    GROUP BY 1, 2
),
metric_rollup AS (
    SELECT
        prompt_id,
        site,
        SUM(favorite_count)::BIGINT AS favorite_count,
        SUM(comment_count)::BIGINT AS comment_count,
        SUM(click_count)::BIGINT AS click_count
    FROM metric_events
    WHERE COALESCE(BTRIM(prompt_id), '') <> ''
    GROUP BY prompt_id, site
)
INSERT INTO public.prompt_hotness_metrics (
    prompt_id,
    site,
    favorite_count,
    comment_count,
    click_count,
    updated_at
)
SELECT
    prompt_id,
    site,
    favorite_count,
    comment_count,
    click_count,
    NOW()
FROM metric_rollup
WHERE NOT EXISTS (SELECT 1 FROM public.prompt_hotness_metrics)
ON CONFLICT (prompt_id, site) DO UPDATE
SET
    favorite_count = EXCLUDED.favorite_count,
    comment_count = EXCLUDED.comment_count,
    click_count = EXCLUDED.click_count,
    updated_at = NOW();

CREATE OR REPLACE FUNCTION public.fn_adjust_prompt_hotness_metric(
    p_prompt_id TEXT,
    p_site TEXT,
    p_favorite_delta BIGINT DEFAULT 0,
    p_comment_delta BIGINT DEFAULT 0,
    p_click_delta BIGINT DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prompt_id TEXT := BTRIM(COALESCE(p_prompt_id, ''));
    v_site TEXT := CASE WHEN LOWER(BTRIM(COALESCE(p_site, 'cn'))) = 'intl' THEN 'intl' ELSE 'cn' END;
BEGIN
    IF v_prompt_id = '' THEN
        RETURN;
    END IF;

    INSERT INTO public.prompt_hotness_metrics (
        prompt_id,
        site,
        favorite_count,
        comment_count,
        click_count,
        updated_at
    )
    VALUES (
        v_prompt_id,
        v_site,
        GREATEST(0, COALESCE(p_favorite_delta, 0)),
        GREATEST(0, COALESCE(p_comment_delta, 0)),
        GREATEST(0, COALESCE(p_click_delta, 0)),
        NOW()
    )
    ON CONFLICT (prompt_id, site) DO UPDATE
    SET
        favorite_count = GREATEST(0, public.prompt_hotness_metrics.favorite_count + COALESCE(p_favorite_delta, 0)),
        comment_count = GREATEST(0, public.prompt_hotness_metrics.comment_count + COALESCE(p_comment_delta, 0)),
        click_count = GREATEST(0, public.prompt_hotness_metrics.click_count + COALESCE(p_click_delta, 0)),
        updated_at = NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.fn_adjust_prompt_hotness_metric(TEXT, TEXT, BIGINT, BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_adjust_prompt_hotness_metric(TEXT, TEXT, BIGINT, BIGINT, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_sync_prompt_favorite_hotness()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP IN ('DELETE', 'UPDATE') THEN
        PERFORM public.fn_adjust_prompt_hotness_metric(OLD.prompt_id, OLD.site, -1, 0, 0);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM public.fn_adjust_prompt_hotness_metric(NEW.prompt_id, NEW.site, 1, 0, 0);
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_prompt_favorite_hotness ON public.prompt_favorites;
CREATE TRIGGER trigger_sync_prompt_favorite_hotness
    AFTER INSERT OR UPDATE OR DELETE ON public.prompt_favorites
    FOR EACH ROW EXECUTE FUNCTION public.trg_sync_prompt_favorite_hotness();

CREATE OR REPLACE FUNCTION public.trg_sync_prompt_comment_hotness()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP IN ('DELETE', 'UPDATE') THEN
        PERFORM public.fn_adjust_prompt_hotness_metric(OLD.prompt_id::TEXT, OLD.site, 0, -1, 0);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM public.fn_adjust_prompt_hotness_metric(NEW.prompt_id::TEXT, NEW.site, 0, 1, 0);
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_prompt_comment_hotness ON public.prompt_comments;
CREATE TRIGGER trigger_sync_prompt_comment_hotness
    AFTER INSERT OR UPDATE OR DELETE ON public.prompt_comments
    FOR EACH ROW EXECUTE FUNCTION public.trg_sync_prompt_comment_hotness();

CREATE OR REPLACE FUNCTION public.fn_record_prompt_card_click(
    p_prompt_id TEXT,
    p_site TEXT DEFAULT 'cn',
    p_session_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_prompt_id TEXT := BTRIM(COALESCE(p_prompt_id, ''));
    v_site TEXT := CASE WHEN LOWER(BTRIM(COALESCE(p_site, 'cn'))) = 'intl' THEN 'intl' ELSE 'cn' END;
    v_session_id TEXT := LEFT(BTRIM(COALESCE(p_session_id, '')), 160);
    v_inserted BOOLEAN := FALSE;
BEGIN
    IF v_prompt_id = '' OR v_session_id = '' OR NOT EXISTS (
        SELECT 1 FROM public.prompts p WHERE p.id::TEXT = v_prompt_id
    ) THEN
        RETURN FALSE;
    END IF;

    INSERT INTO public.prompt_card_clicks (prompt_id, site, session_key)
    VALUES (v_prompt_id, v_site, MD5(v_session_id))
    ON CONFLICT (prompt_id, site, session_key) DO NOTHING
    RETURNING TRUE INTO v_inserted;

    IF COALESCE(v_inserted, FALSE) THEN
        PERFORM public.fn_adjust_prompt_hotness_metric(v_prompt_id, v_site, 0, 0, 1);
    END IF;

    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_record_prompt_card_click(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_record_prompt_card_click(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_public_prompt_hotness(p_site TEXT DEFAULT 'cn')
RETURNS TABLE (
    prompt_id TEXT,
    favorite_count BIGINT,
    comment_count BIGINT,
    click_count BIGINT,
    hot_score NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH normalized_site AS (
        SELECT CASE WHEN LOWER(BTRIM(COALESCE(p_site, 'cn'))) = 'intl' THEN 'intl' ELSE 'cn' END AS value
    )
    SELECT
        p.id::TEXT AS prompt_id,
        COALESCE(m.favorite_count, 0)::BIGINT AS favorite_count,
        COALESCE(m.comment_count, 0)::BIGINT AS comment_count,
        COALESCE(m.click_count, 0)::BIGINT AS click_count,
        (
            COALESCE(m.favorite_count, 0) * 12
            + COALESCE(m.comment_count, 0) * 6
            + COALESCE(m.click_count, 0)
        )::NUMERIC AS hot_score
    FROM public.prompts p
    CROSS JOIN normalized_site ns
    LEFT JOIN public.prompt_hotness_metrics m
        ON m.prompt_id = p.id::TEXT
       AND m.site = ns.value;
$$;

REVOKE ALL ON FUNCTION public.fn_public_prompt_hotness(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_public_prompt_hotness(TEXT) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
