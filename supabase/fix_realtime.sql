-- 1. Enable Realtime for the chat_messages table
-- valid for Supabase generic replication
begin;
  -- Try to add the table to the publication. 
  -- If it fails (already added), it's fine, but standard SQL 'alter publication' might error if already exists depending on pg version.
  -- Safe way: drop and re-add or just run it and ignore "duplicate" error if user knows how.
  -- Simpler: Just run the alter command.
  alter publication supabase_realtime add table chat_messages;
commit;

-- 2. Ensure RLS allows reading (Crucial for Realtime to broadcast the row)
drop policy if exists "Public read access" on chat_messages;
create policy "Public read access"
on chat_messages for select
using (true);

-- 3. Ensure Insert is also public
drop policy if exists "Public insert access" on chat_messages;
create policy "Public insert access"
on chat_messages for insert
with check (true);
