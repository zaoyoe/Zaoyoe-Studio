-- Keep Meigen repository preflight on indexed paths and skip unused media branches.

CREATE INDEX IF NOT EXISTS idx_prompts_primary_video_sha256_prefixed_import_dedupe
    ON public.prompts (('sha256:' || primary_video_sha256))
    WHERE primary_video_sha256 IS NOT NULL AND primary_video_sha256 <> '';

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
    WHERE cardinality(coalesce(p_source_urls, '{}'::TEXT[])) > 0
        AND p.source_url IS NOT NULL
        AND btrim(p.source_url) <> ''
        AND p.source_url = ANY(coalesce(p_source_urls, '{}'::TEXT[]))

    UNION ALL

    SELECT p.id::TEXT, p.source_url, public.fn_prompt_import_prompt_hash(p.prompt_text), NULL::TEXT, NULL::TEXT
    FROM public.prompts AS p
    WHERE cardinality(coalesce(p_prompt_hashes, '{}'::TEXT[])) > 0
        AND p.prompt_text IS NOT NULL
        AND btrim(p.prompt_text) <> ''
        AND public.fn_prompt_import_prompt_hash(p.prompt_text)
            = ANY(coalesce(p_prompt_hashes, '{}'::TEXT[]))

    UNION ALL

    SELECT p.id::TEXT, p.source_url, public.fn_prompt_import_prompt_hash(p.prompt_text_en), NULL::TEXT, NULL::TEXT
    FROM public.prompts AS p
    WHERE cardinality(coalesce(p_prompt_hashes, '{}'::TEXT[])) > 0
        AND p.prompt_text_en IS NOT NULL
        AND btrim(p.prompt_text_en) <> ''
        AND public.fn_prompt_import_prompt_hash(p.prompt_text_en)
            = ANY(coalesce(p_prompt_hashes, '{}'::TEXT[]))

    UNION ALL

    SELECT p.id::TEXT, p.source_url, public.fn_prompt_import_prompt_hash(p.prompt_text_zh), NULL::TEXT, NULL::TEXT
    FROM public.prompts AS p
    WHERE cardinality(coalesce(p_prompt_hashes, '{}'::TEXT[])) > 0
        AND p.prompt_text_zh IS NOT NULL
        AND btrim(p.prompt_text_zh) <> ''
        AND public.fn_prompt_import_prompt_hash(p.prompt_text_zh)
            = ANY(coalesce(p_prompt_hashes, '{}'::TEXT[]))

    UNION ALL

    SELECT p.id::TEXT, p.source_url, NULL::TEXT, matched.value, NULL::TEXT
    FROM public.prompts AS p
    CROSS JOIN LATERAL unnest(p.video_fingerprints) AS matched(value)
    WHERE cardinality(coalesce(p_video_fingerprints, '{}'::TEXT[])) > 0
        AND p.video_fingerprints && coalesce(p_video_fingerprints, '{}'::TEXT[])
        AND matched.value = ANY(coalesce(p_video_fingerprints, '{}'::TEXT[]))

    UNION ALL

    SELECT p.id::TEXT, p.source_url, NULL::TEXT, NULL::TEXT, matched.value
    FROM public.prompts AS p
    CROSS JOIN LATERAL unnest(p.video_fingerprints) AS matched(value)
    WHERE cardinality(coalesce(p_video_hashes, '{}'::TEXT[])) > 0
        AND p.video_fingerprints && coalesce(p_video_hashes, '{}'::TEXT[])
        AND matched.value = ANY(coalesce(p_video_hashes, '{}'::TEXT[]))

    UNION ALL

    SELECT p.id::TEXT, p.source_url, NULL::TEXT, NULL::TEXT, 'sha256:' || p.primary_video_sha256
    FROM public.prompts AS p
    WHERE cardinality(coalesce(p_video_hashes, '{}'::TEXT[])) > 0
        AND p.primary_video_sha256 IS NOT NULL
        AND p.primary_video_sha256 <> ''
        AND 'sha256:' || p.primary_video_sha256 = ANY(coalesce(p_video_hashes, '{}'::TEXT[]))

    UNION ALL

    SELECT p.id::TEXT, p.source_url, NULL::TEXT, matched.value, NULL::TEXT
    FROM public.prompts AS p
    CROSS JOIN LATERAL unnest(p.video_poster_hashes) AS matched(value)
    WHERE cardinality(coalesce(p_video_poster_hashes, '{}'::TEXT[])) > 0
        AND p.video_poster_hashes && coalesce(p_video_poster_hashes, '{}'::TEXT[])
        AND matched.value = ANY(coalesce(p_video_poster_hashes, '{}'::TEXT[]));
$$;

REVOKE ALL ON FUNCTION public.fn_admin_find_prompt_duplicates(TEXT[], TEXT[], TEXT[], TEXT[], TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_admin_find_prompt_duplicates(TEXT[], TEXT[], TEXT[], TEXT[], TEXT[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_find_prompt_duplicates(TEXT[], TEXT[], TEXT[], TEXT[], TEXT[]) TO service_role;
