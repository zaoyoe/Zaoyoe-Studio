-- This migration intentionally uses short transactions so live prompt reads do
-- not share one long lock chain with the backfill and both index builds.
-- Run this file as-is; do not wrap the whole file in another BEGIN/COMMIT block.

BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

COMMIT;

-- Acquire the prompts lock before touching functions, triggers, or policies.
-- This fixed lock order prevents the lock inversion seen under live traffic.
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

LOCK TABLE public.prompts IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.prompts
    ADD COLUMN IF NOT EXISTS gallery_status TEXT NOT NULL DEFAULT 'published',
    ADD COLUMN IF NOT EXISTS gallery_search_text TEXT NOT NULL DEFAULT '';

ALTER TABLE public.prompts
    DROP CONSTRAINT IF EXISTS prompts_gallery_status_check;

ALTER TABLE public.prompts
    ADD CONSTRAINT prompts_gallery_status_check
    CHECK (gallery_status IN ('published', 'draft', 'archived'))
    NOT VALID;

CREATE OR REPLACE FUNCTION public.sync_prompt_gallery_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status TEXT := LOWER(BTRIM(COALESCE(
        NEW.ai_tags #>> '{admin,status}',
        NEW.ai_tags #>> '{ops,status}',
        ''
    )));
BEGIN
    NEW.gallery_status := CASE
        WHEN v_status IN ('draft', 'archived') THEN v_status
        ELSE 'published'
    END;
    NEW.gallery_search_text := LOWER(BTRIM(CONCAT_WS(' ',
        COALESCE(NEW.title, ''),
        COALESCE(NEW.title_en, ''),
        COALESCE(NEW.title_zh, ''),
        COALESCE(NEW.description, ''),
        COALESCE(NEW.description_en, ''),
        COALESCE(NEW.description_zh, ''),
        COALESCE(NEW.prompt_text, ''),
        COALESCE(NEW.prompt_text_en, ''),
        COALESCE(NEW.prompt_text_zh, ''),
        ARRAY_TO_STRING(COALESCE(NEW.tags, '{}'::TEXT[]), ' '),
        ARRAY_TO_STRING(COALESCE(NEW.dominant_colors, '{}'::TEXT[]), ' '),
        COALESCE(NEW.ai_tags::TEXT, '')
    )));
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_prompt_gallery_status ON public.prompts;
CREATE TRIGGER trigger_sync_prompt_gallery_status
    BEFORE INSERT OR UPDATE OF
        ai_tags,
        title,
        title_en,
        title_zh,
        description,
        description_en,
        description_zh,
        prompt_text,
        prompt_text_en,
        prompt_text_zh,
        tags,
        dominant_colors
    ON public.prompts
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_prompt_gallery_status();

COMMENT ON COLUMN public.prompts.gallery_status IS
    'Public prompt-gallery visibility, synchronized from ai_tags.admin/ops.status.';

COMMENT ON COLUMN public.prompts.gallery_search_text IS
    'Lower-cased public gallery search document maintained by trigger.';

COMMIT;

-- Backfill separately so the structure lock above is released first. Re-runs
-- only update stale rows instead of rewriting the whole table again.
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '10min';

WITH desired_gallery_values AS MATERIALIZED (
    SELECT
        id,
        CASE
            WHEN LOWER(BTRIM(COALESCE(
                ai_tags #>> '{admin,status}',
                ai_tags #>> '{ops,status}',
                ''
            ))) IN ('draft', 'archived')
                THEN LOWER(BTRIM(COALESCE(
                    ai_tags #>> '{admin,status}',
                    ai_tags #>> '{ops,status}'
                )))
            ELSE 'published'
        END AS gallery_status,
        LOWER(BTRIM(CONCAT_WS(' ',
            COALESCE(title, ''),
            COALESCE(title_en, ''),
            COALESCE(title_zh, ''),
            COALESCE(description, ''),
            COALESCE(description_en, ''),
            COALESCE(description_zh, ''),
            COALESCE(prompt_text, ''),
            COALESCE(prompt_text_en, ''),
            COALESCE(prompt_text_zh, ''),
            ARRAY_TO_STRING(COALESCE(tags, '{}'::TEXT[]), ' '),
            ARRAY_TO_STRING(COALESCE(dominant_colors, '{}'::TEXT[]), ' '),
            COALESCE(ai_tags::TEXT, '')
        ))) AS gallery_search_text
    FROM public.prompts
)
UPDATE public.prompts AS prompt
SET
    gallery_status = desired.gallery_status,
    gallery_search_text = desired.gallery_search_text
FROM desired_gallery_values AS desired
WHERE prompt.id = desired.id
  AND (
      prompt.gallery_status IS DISTINCT FROM desired.gallery_status
      OR prompt.gallery_search_text IS DISTINCT FROM desired.gallery_search_text
  );

COMMIT;

BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '10min';

ALTER TABLE public.prompts
    VALIDATE CONSTRAINT prompts_gallery_status_check;

COMMIT;

-- Build each index in its own transaction. Regular SELECTs can continue while
-- these non-concurrent builds run; writes may wait until each build completes.
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '10min';

CREATE INDEX IF NOT EXISTS idx_prompts_public_gallery_cursor
    ON public.prompts(created_at DESC, id DESC)
    WHERE gallery_status = 'published'
      AND prompt_text IS NOT NULL
      AND prompt_text <> '';

COMMIT;

BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '10min';

CREATE INDEX IF NOT EXISTS idx_prompts_public_gallery_search
    ON public.prompts USING GIN (gallery_search_text extensions.gin_trgm_ops)
    WHERE gallery_status = 'published'
      AND prompt_text IS NOT NULL
      AND prompt_text <> '';

COMMIT;

-- Publish the RLS policy and RPC atomically after the backfill and indexes are
-- ready. The prompts lock is again acquired before catalog objects are changed.
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

LOCK TABLE public.prompts IN ACCESS EXCLUSIVE MODE;

DROP POLICY IF EXISTS "Public read access" ON public.prompts;
DROP POLICY IF EXISTS "Prompts are viewable by everyone." ON public.prompts;
DROP POLICY IF EXISTS "Published prompts are publicly readable" ON public.prompts;

CREATE POLICY "Published prompts are publicly readable"
    ON public.prompts
    FOR SELECT
    TO anon, authenticated
    USING (gallery_status = 'published');

CREATE OR REPLACE FUNCTION public.search_public_prompts(
    p_terms TEXT[],
    p_limit INTEGER DEFAULT 80
)
RETURNS TABLE(item JSONB)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
    WITH normalized_terms AS (
        SELECT DISTINCT LOWER(BTRIM(term)) AS term
        FROM UNNEST(COALESCE(p_terms, '{}'::TEXT[])) AS term
        WHERE CHAR_LENGTH(BTRIM(term)) >= 2
        LIMIT 12
    )
    SELECT JSONB_BUILD_OBJECT(
        'id', prompt.id,
        'title', prompt.title,
        'title_en', prompt.title_en,
        'title_zh', prompt.title_zh,
        'tags', prompt.tags,
        'images', prompt.images,
        'image_assets', prompt.image_assets,
        'video_assets', prompt.video_assets,
        'dominant_colors', prompt.dominant_colors,
        'source_url', prompt.source_url,
        'source_author_name', prompt.source_author_name,
        'source_author_handle', prompt.source_author_handle,
        'source_author_avatar_url', prompt.source_author_avatar_url,
        'gallery_status', prompt.gallery_status,
        'created_at', prompt.created_at
    ) AS item
    FROM public.prompts AS prompt
    WHERE prompt.gallery_status = 'published'
      AND prompt.prompt_text IS NOT NULL
      AND prompt.prompt_text <> ''
      AND prompt.gallery_search_text ILIKE ANY (
          ARRAY(SELECT '%' || term || '%' FROM normalized_terms)
      )
    ORDER BY prompt.created_at DESC, prompt.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 80), 1), 80);
$$;

REVOKE ALL ON FUNCTION public.search_public_prompts(TEXT[], INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_public_prompts(TEXT[], INTEGER) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
