-- Create a new storage bucket for chat images
insert into storage.buckets (id, name, public)
values ('chat-assets', 'chat-assets', true);

-- Policy to allow anyone to read images (Public Access)
create policy "Public Access"
on storage.objects for select
using ( bucket_id = 'chat-assets' );

-- Policy to allow anyone to upload images (Public Upload)
create policy "Public Upload"
on storage.objects for insert
with check ( bucket_id = 'chat-assets' );
