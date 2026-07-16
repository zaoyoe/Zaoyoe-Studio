-- Prompts table for storing AI art prompts
CREATE TABLE IF NOT EXISTS prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    tags TEXT[] DEFAULT '{}',
    description TEXT,
    prompt_text TEXT,
    images TEXT[] DEFAULT '{}',
    image_assets JSONB DEFAULT '[]'::jsonb,
    dominant_colors TEXT[] DEFAULT '{}',
    image_palettes JSONB NOT NULL DEFAULT '[]'::jsonb,
    ai_tags JSONB,
    quality_score FLOAT,
    source_url TEXT,
    source_author_name TEXT,
    source_author_handle TEXT,
    source_author_avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read prompts
CREATE POLICY "Public read access" ON prompts
    FOR SELECT USING (true);

-- Policy: Only the service role can manage prompts
CREATE POLICY "Service role can manage prompts." ON prompts
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

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
