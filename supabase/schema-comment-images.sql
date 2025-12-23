-- ============================================
-- COMMENT IMAGE ATTACHMENTS - DATABASE SETUP
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. Create Storage Bucket for comment images
insert into storage.buckets (id, name, public)
values ('comment-images', 'comment-images', true)
on conflict (id) do nothing;

-- 2. Storage Policies

-- Allow authenticated users to upload images
create policy "Authenticated users can upload comment images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'comment-images');

-- Allow anyone to view images (public read)
create policy "Anyone can view comment images"
on storage.objects for select
to public
using (bucket_id = 'comment-images');

-- Allow users to delete their own images (optional, for future cleanup)
create policy "Users can delete own comment images"
on storage.objects for delete
to authenticated
using (bucket_id = 'comment-images' and auth.uid()::text = (storage.foldername(name))[1]);

-- 3. Add image_url column to prompt_comments table
alter table public.prompt_comments 
add column if not exists image_url text;

comment on column public.prompt_comments.image_url is 'URL to attached image in Supabase Storage';

-- 4. Verify setup
select 
    column_name, 
    data_type, 
    is_nullable
from information_schema.columns
where table_name = 'prompt_comments'
order by ordinal_position;
