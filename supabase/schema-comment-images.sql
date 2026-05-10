-- ============================================
-- COMMENT IMAGE ATTACHMENTS - DATABASE SETUP
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Keep the legacy Supabase Storage bucket private for migration/cleanup only.
-- New comment images must be uploaded to R2/CDN through the upload-avatar Edge Function.
insert into storage.buckets (id, name, public)
values ('comment-images', 'comment-images', false)
on conflict (id) do nothing;

update storage.buckets
set
    public = false,
    file_size_limit = 1,
    allowed_mime_types = ARRAY['application/x-supabase-image-bucket-disabled']::text[]
where id = 'comment-images';

-- 2. Storage Policies

-- Direct uploads are intentionally disabled. Prompt comment images should be
-- uploaded to R2/CDN through the upload-avatar Edge Function instead of
-- Supabase Storage.

-- Allow users to delete their own images (optional, for future cleanup)
create policy "Users can delete own comment images"
on storage.objects for delete
to authenticated
using (bucket_id = 'comment-images' and auth.uid()::text = (storage.foldername(name))[1]);

-- 3. Add image_url column to prompt_comments table
alter table public.prompt_comments 
add column if not exists image_url text;

comment on column public.prompt_comments.image_url is 'URL to attached image in R2/CDN';

-- 4. Verify setup
select 
    column_name, 
    data_type, 
    is_nullable
from information_schema.columns
where table_name = 'prompt_comments'
order by ordinal_position;
