-- Prompts table for storing AI art prompts
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    title_en TEXT,
    title_zh TEXT,
    tags TEXT[] DEFAULT '{}',
    description TEXT,
    description_en TEXT,
    description_zh TEXT,
    prompt_text TEXT,
    prompt_text_en TEXT,
    prompt_text_zh TEXT,
    images TEXT[] DEFAULT '{}',
    image_assets JSONB DEFAULT '[]'::jsonb,
    video_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
    dominant_colors TEXT[] DEFAULT '{}',
    image_palettes JSONB NOT NULL DEFAULT '[]'::jsonb,
    ai_tags JSONB,
    quality_score FLOAT,
    source_url TEXT,
    source_author_name TEXT,
    source_author_handle TEXT,
    source_author_avatar_url TEXT,
    gallery_status TEXT NOT NULL DEFAULT 'published'
        CHECK (gallery_status IN ('published', 'draft', 'archived')),
    gallery_search_text TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;

-- Only published prompts are exposed through the public REST API.
CREATE POLICY "Published prompts are publicly readable" ON prompts
    FOR SELECT TO anon, authenticated
    USING (gallery_status = 'published');

-- Policy: Only the service role can manage prompts
CREATE POLICY "Service role can manage prompts." ON prompts
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION sync_prompt_gallery_status()
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
    ON prompts
    FOR EACH ROW
    EXECUTE FUNCTION sync_prompt_gallery_status();

CREATE INDEX IF NOT EXISTS idx_prompts_public_gallery_cursor
    ON prompts(created_at DESC, id DESC)
    WHERE gallery_status = 'published'
      AND prompt_text IS NOT NULL
      AND prompt_text <> '';

CREATE INDEX IF NOT EXISTS idx_prompts_public_gallery_search
    ON prompts USING GIN (gallery_search_text extensions.gin_trgm_ops)
    WHERE gallery_status = 'published'
      AND prompt_text IS NOT NULL
      AND prompt_text <> '';

CREATE OR REPLACE FUNCTION search_public_prompts(
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
    FROM prompts AS prompt
    WHERE prompt.gallery_status = 'published'
      AND prompt.prompt_text IS NOT NULL
      AND prompt.prompt_text <> ''
      AND prompt.gallery_search_text ILIKE ANY (
          ARRAY(SELECT '%' || term || '%' FROM normalized_terms)
      )
    ORDER BY prompt.created_at DESC, prompt.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 80), 1), 80);
$$;

REVOKE ALL ON FUNCTION search_public_prompts(TEXT[], INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_public_prompts(TEXT[], INTEGER) TO anon, authenticated, service_role;

-- Legacy Supabase Storage bucket is kept private for migration/cleanup only.
-- New prompt images must be uploaded to R2/CDN through the upload-to-r2 Edge Function.
INSERT INTO storage.buckets (id, name, public)
VALUES ('prompt-images', 'prompt-images', false)
ON CONFLICT (id) DO NOTHING;

UPDATE storage.buckets
SET
    public = false,
    file_size_limit = 1,
    allowed_mime_types = ARRAY['application/x-supabase-image-bucket-disabled']::text[]
WHERE id = 'prompt-images';
