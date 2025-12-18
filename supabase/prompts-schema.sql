-- Prompts table for storing AI art prompts
CREATE TABLE IF NOT EXISTS prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    tags TEXT[] DEFAULT '{}',
    description TEXT,
    prompt_text TEXT,
    images TEXT[] DEFAULT '{}',
    dominant_colors TEXT[] DEFAULT '{}',
    ai_tags JSONB,
    quality_score FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read prompts
CREATE POLICY "Public read access" ON prompts
    FOR SELECT USING (true);

-- Policy: Only authenticated users can insert
CREATE POLICY "Authenticated insert" ON prompts
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Policy: Only authenticated users can update
CREATE POLICY "Authenticated update" ON prompts
    FOR UPDATE USING (auth.role() = 'authenticated');

-- Create storage bucket for prompt images
INSERT INTO storage.buckets (id, name, public)
VALUES ('prompt-images', 'prompt-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: Anyone can view images
CREATE POLICY "Public image access" ON storage.objects
    FOR SELECT USING (bucket_id = 'prompt-images');

-- Storage policy: Only authenticated users can upload
CREATE POLICY "Authenticated image upload" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'prompt-images' AND auth.role() = 'authenticated');
