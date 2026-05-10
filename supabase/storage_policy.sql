-- Legacy Supabase Storage image buckets. Keep them private for
-- migration/cleanup only; new Prompt, comment, chat, avatar and shop images
-- go to R2/CDN upload functions instead of Supabase Storage.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
    ('prompt-images', 'prompt-images', false, 1, ARRAY['application/x-supabase-image-bucket-disabled']::text[]),
    ('comment-images', 'comment-images', false, 1, ARRAY['application/x-supabase-image-bucket-disabled']::text[]),
    ('chat-assets', 'chat-assets', false, 1, ARRAY['application/x-supabase-image-bucket-disabled']::text[]),
    ('chat-images', 'chat-images', false, 1, ARRAY['application/x-supabase-image-bucket-disabled']::text[])
on conflict (id) do update
set
    public = false,
    file_size_limit = 1,
    allowed_mime_types = ARRAY['application/x-supabase-image-bucket-disabled']::text[];

update storage.buckets
set
    public = false,
    file_size_limit = 1,
    allowed_mime_types = ARRAY['application/x-supabase-image-bucket-disabled']::text[]
where id in (
    'prompt-images',
    'comment-images',
    'chat-assets',
    'chat-images'
);

drop policy if exists "Block direct Supabase image bucket uploads" on storage.objects;

create policy "Block direct Supabase image bucket uploads"
on storage.objects
as restrictive
for insert
to public
with check (
    bucket_id not in (
        'prompt-images',
        'comment-images',
        'chat-assets',
        'chat-images'
    )
);

drop policy if exists "Public Upload" on storage.objects;
drop policy if exists "Authenticated image upload" on storage.objects;
drop policy if exists "Authenticated users can upload comment images" on storage.objects;
drop policy if exists "Public Access" on storage.objects;
drop policy if exists "Public image access" on storage.objects;
drop policy if exists "Anyone can view comment images" on storage.objects;
