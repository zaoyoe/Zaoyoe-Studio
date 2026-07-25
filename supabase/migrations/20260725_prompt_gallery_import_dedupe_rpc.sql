-- Fast, normalized prompt repository dedupe for Gallery imports.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.prompts
    ADD COLUMN IF NOT EXISTS video_fingerprints TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    ADD COLUMN IF NOT EXISTS video_poster_hashes TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    ADD COLUMN IF NOT EXISTS primary_video_sha256 TEXT;

ALTER TABLE public.prompt_import_items
    ADD COLUMN IF NOT EXISTS video_fingerprints TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    ADD COLUMN IF NOT EXISTS video_poster_hashes TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    ADD COLUMN IF NOT EXISTS video_content_hashes TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

CREATE OR REPLACE FUNCTION public.fn_prompt_import_normalize_text(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
    SELECT btrim(
        regexp_replace(
            replace(
                replace(
                    replace(
                        replace(lower(coalesce(p_value, '')), chr(8220), '"'),
                        chr(8221), '"'
                    ),
                    chr(8216), ''''
                ),
                chr(8217), ''''
            ),
            E'\\s+',
            ' ',
            'g'
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.fn_prompt_import_prompt_hash(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, extensions, public
AS $$
    SELECT CASE
        WHEN public.fn_prompt_import_normalize_text(p_value) = '' THEN ''
        ELSE encode(
            digest(
                convert_to(public.fn_prompt_import_normalize_text(p_value), 'UTF8'),
                'sha256'
            ),
            'hex'
        )
    END;
$$;

CREATE INDEX IF NOT EXISTS idx_prompts_source_url_import_dedupe
    ON public.prompts(source_url)
    WHERE source_url IS NOT NULL AND btrim(source_url) <> '';

CREATE INDEX IF NOT EXISTS idx_prompts_prompt_text_import_hash
    ON public.prompts(public.fn_prompt_import_prompt_hash(prompt_text))
    WHERE prompt_text IS NOT NULL AND btrim(prompt_text) <> '';

CREATE INDEX IF NOT EXISTS idx_prompts_prompt_text_en_import_hash
    ON public.prompts(public.fn_prompt_import_prompt_hash(prompt_text_en))
    WHERE prompt_text_en IS NOT NULL AND btrim(prompt_text_en) <> '';

CREATE INDEX IF NOT EXISTS idx_prompts_prompt_text_zh_import_hash
    ON public.prompts(public.fn_prompt_import_prompt_hash(prompt_text_zh))
    WHERE prompt_text_zh IS NOT NULL AND btrim(prompt_text_zh) <> '';

CREATE INDEX IF NOT EXISTS idx_prompts_video_fingerprints_import_dedupe
    ON public.prompts USING gin(video_fingerprints);

CREATE INDEX IF NOT EXISTS idx_prompts_video_poster_hashes_import_dedupe
    ON public.prompts USING gin(video_poster_hashes);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_prompts_primary_video_sha256
    ON public.prompts(primary_video_sha256)
    WHERE primary_video_sha256 IS NOT NULL AND primary_video_sha256 <> '';

WITH backfill AS (
    SELECT
        p.id,
        array_agg(DISTINCT 'sha256-prefix:' || captures.value[1]) AS fingerprints
    FROM public.prompts AS p
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.video_assets, '[]'::jsonb)) AS asset
    CROSS JOIN LATERAL regexp_match(
        coalesce(asset->>'storage_path', asset->>'original', ''),
        E'-([0-9a-f]{16})\\.[a-z0-9]+(?:[?#].*)?$'
    ) AS captures(value)
    GROUP BY p.id
)
UPDATE public.prompts AS p
SET video_fingerprints = (
    SELECT array_agg(DISTINCT value)
    FROM unnest(coalesce(p.video_fingerprints, '{}'::TEXT[]) || backfill.fingerprints) AS value
)
FROM backfill
WHERE p.id = backfill.id;

UPDATE public.prompts AS p
SET video_poster_hashes = coalesce((
    SELECT array_agg(DISTINCT value)
    FROM unnest(
        coalesce(p.video_poster_hashes, '{}'::TEXT[])
        || coalesce((
            SELECT array_agg('poster-sha256:' || substr(palette->>'image_hash', 8))
            FROM jsonb_array_elements(coalesce(p.image_palettes, '[]'::jsonb)) AS palette
            WHERE palette->>'image_hash' ~ '^sha256:[0-9a-f]{64}$'
                AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(coalesce(p.video_assets, '[]'::jsonb)) AS asset
                    WHERE coalesce(
                        asset->>'poster',
                        asset->>'poster_url',
                        asset#>>'{poster_asset,original}',
                        ''
                    ) = palette->>'image_url'
                )
        ), '{}'::TEXT[])
    ) AS value
), '{}'::TEXT[])
WHERE jsonb_array_length(coalesce(p.video_assets, '[]'::jsonb)) > 0
    AND jsonb_array_length(coalesce(p.image_palettes, '[]'::jsonb)) > 0;

DROP FUNCTION IF EXISTS public.fn_admin_find_prompt_duplicates(TEXT[], TEXT[]);
DROP FUNCTION IF EXISTS public.fn_admin_find_prompt_duplicates(TEXT[], TEXT[], TEXT[], TEXT[]);

CREATE OR REPLACE FUNCTION public.fn_admin_find_prompt_duplicates(
    p_source_urls TEXT[] DEFAULT '{}'::TEXT[],
    p_prompt_hashes TEXT[] DEFAULT '{}'::TEXT[],
    p_video_fingerprints TEXT[] DEFAULT '{}'::TEXT[],
    p_video_hashes TEXT[] DEFAULT '{}'::TEXT[],
    p_video_poster_hashes TEXT[] DEFAULT '{}'::TEXT[]
)
RETURNS TABLE(id TEXT, source_url TEXT, prompt_hash TEXT, video_fingerprint TEXT, video_hash TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT p.id::TEXT, p.source_url, NULL::TEXT, NULL::TEXT, NULL::TEXT
    FROM public.prompts AS p
    WHERE p.source_url = ANY(coalesce(p_source_urls, '{}'::TEXT[]))

    UNION ALL

    SELECT p.id::TEXT, p.source_url, public.fn_prompt_import_prompt_hash(p.prompt_text), NULL::TEXT, NULL::TEXT
    FROM public.prompts AS p
    WHERE public.fn_prompt_import_prompt_hash(p.prompt_text)
        = ANY(coalesce(p_prompt_hashes, '{}'::TEXT[]))

    UNION ALL

    SELECT p.id::TEXT, p.source_url, public.fn_prompt_import_prompt_hash(p.prompt_text_en), NULL::TEXT, NULL::TEXT
    FROM public.prompts AS p
    WHERE public.fn_prompt_import_prompt_hash(p.prompt_text_en)
        = ANY(coalesce(p_prompt_hashes, '{}'::TEXT[]))

    UNION ALL

    SELECT p.id::TEXT, p.source_url, public.fn_prompt_import_prompt_hash(p.prompt_text_zh), NULL::TEXT, NULL::TEXT
    FROM public.prompts AS p
    WHERE public.fn_prompt_import_prompt_hash(p.prompt_text_zh)
        = ANY(coalesce(p_prompt_hashes, '{}'::TEXT[]))

    UNION ALL

    SELECT p.id::TEXT, p.source_url, NULL::TEXT, matched.value, NULL::TEXT
    FROM public.prompts AS p
    CROSS JOIN LATERAL unnest(p.video_fingerprints) AS matched(value)
    WHERE p.video_fingerprints && coalesce(p_video_fingerprints, '{}'::TEXT[])
        AND matched.value = ANY(coalesce(p_video_fingerprints, '{}'::TEXT[]))

    UNION ALL

    SELECT p.id::TEXT, p.source_url, NULL::TEXT, NULL::TEXT, matched.value
    FROM public.prompts AS p
    CROSS JOIN LATERAL unnest(p.video_fingerprints) AS matched(value)
    WHERE p.video_fingerprints && coalesce(p_video_hashes, '{}'::TEXT[])
        AND matched.value = ANY(coalesce(p_video_hashes, '{}'::TEXT[]))

    UNION ALL

    SELECT p.id::TEXT, p.source_url, NULL::TEXT, NULL::TEXT, 'sha256:' || p.primary_video_sha256
    FROM public.prompts AS p
    WHERE 'sha256:' || p.primary_video_sha256 = ANY(coalesce(p_video_hashes, '{}'::TEXT[]))

    UNION ALL

    SELECT p.id::TEXT, p.source_url, NULL::TEXT, matched.value, NULL::TEXT
    FROM public.prompts AS p
    CROSS JOIN LATERAL unnest(p.video_poster_hashes) AS matched(value)
    WHERE p.video_poster_hashes && coalesce(p_video_poster_hashes, '{}'::TEXT[])
        AND matched.value = ANY(coalesce(p_video_poster_hashes, '{}'::TEXT[]));
$$;

REVOKE ALL ON FUNCTION public.fn_admin_find_prompt_duplicates(TEXT[], TEXT[], TEXT[], TEXT[], TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_admin_find_prompt_duplicates(TEXT[], TEXT[], TEXT[], TEXT[], TEXT[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_find_prompt_duplicates(TEXT[], TEXT[], TEXT[], TEXT[], TEXT[]) TO service_role;
