-- Block direct browser/client uploads into legacy Supabase image buckets and
-- make the buckets private after legacy references are migrated to R2/CDN.

DROP POLICY IF EXISTS "Block direct Supabase image bucket uploads" ON storage.objects;

CREATE POLICY "Block direct Supabase image bucket uploads"
ON storage.objects
AS RESTRICTIVE
FOR INSERT
TO public
WITH CHECK (
    bucket_id NOT IN (
        'prompt-images',
        'comment-images',
        'chat-assets',
        'chat-images'
    )
);

DROP POLICY IF EXISTS "Public Upload" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated image upload" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload comment images" ON storage.objects;
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Public image access" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view comment images" ON storage.objects;

UPDATE storage.buckets
SET
    public = false,
    file_size_limit = 1,
    allowed_mime_types = ARRAY['application/x-supabase-image-bucket-disabled']::text[]
WHERE id IN (
    'prompt-images',
    'comment-images',
    'chat-assets',
    'chat-images'
);
