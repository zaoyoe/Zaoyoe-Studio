-- ============================================
-- GUESTBOOK SCHEMA FOR SUPABASE
-- Run this in Supabase SQL Editor
-- ============================================

-- Clean up old guestbook table if exists
drop table if exists public.guestbook_likes cascade;
drop table if exists public.guestbook_comments cascade;
drop table if exists public.guestbook_messages cascade;
drop table if exists public.guestbook cascade;

-- ==========================================
-- 1. MESSAGES TABLE (主留言)
-- ==========================================
create table public.guestbook_messages (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  content text not null,
  image_url text,
  like_count integer default 0,
  created_at timestamptz default now() not null
);

-- Enable RLS
alter table public.guestbook_messages enable row level security;

-- RLS Policies
create policy "Messages are viewable by everyone"
  on guestbook_messages for select
  using (true);

create policy "Authenticated users can post messages"
  on guestbook_messages for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own messages"
  on guestbook_messages for delete
  using (auth.uid() = user_id);

-- ==========================================
-- 2. COMMENTS TABLE (评论，支持嵌套)
-- ==========================================
create table public.guestbook_comments (
  id uuid default gen_random_uuid() primary key,
  message_id uuid references public.guestbook_messages(id) on delete cascade not null,
  parent_id uuid references public.guestbook_comments(id) on delete cascade, -- null = 顶级评论
  user_id uuid references auth.users(id) on delete cascade not null,
  content text not null,
  created_at timestamptz default now() not null
);

-- Enable RLS
alter table public.guestbook_comments enable row level security;

-- RLS Policies
create policy "Comments are viewable by everyone"
  on guestbook_comments for select
  using (true);

create policy "Authenticated users can post comments"
  on guestbook_comments for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own comments"
  on guestbook_comments for delete
  using (auth.uid() = user_id);

-- ==========================================
-- 3. LIKES TABLE (点赞记录)
-- ==========================================
create table public.guestbook_likes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  target_type text not null check (target_type in ('message', 'comment')),
  target_id uuid not null,
  created_at timestamptz default now() not null,
  unique(user_id, target_type, target_id)
);

-- Enable RLS
alter table public.guestbook_likes enable row level security;

-- RLS Policies
create policy "Likes are viewable by everyone"
  on guestbook_likes for select
  using (true);

create policy "Authenticated users can add likes"
  on guestbook_likes for insert
  with check (auth.uid() = user_id);

create policy "Users can remove own likes"
  on guestbook_likes for delete
  using (auth.uid() = user_id);

-- ==========================================
-- 4. TRIGGER: Auto-update like_count
-- ==========================================
create or replace function public.update_message_like_count()
returns trigger as $$
begin
  if TG_OP = 'INSERT' and NEW.target_type = 'message' then
    update public.guestbook_messages 
    set like_count = like_count + 1 
    where id = NEW.target_id;
  elsif TG_OP = 'DELETE' and OLD.target_type = 'message' then
    update public.guestbook_messages 
    set like_count = like_count - 1 
    where id = OLD.target_id;
  end if;
  return coalesce(NEW, OLD);
end;
$$ language plpgsql security definer;

create trigger on_like_change
  after insert or delete on public.guestbook_likes
  for each row execute function public.update_message_like_count();

-- ==========================================
-- 5. INDEXES for performance
-- ==========================================
create index idx_messages_created_at on public.guestbook_messages(created_at desc);
create index idx_comments_message_id on public.guestbook_comments(message_id);
create index idx_comments_parent_id on public.guestbook_comments(parent_id);
create index idx_likes_target on public.guestbook_likes(target_type, target_id);

-- ==========================================
-- 6. ENABLE REALTIME
-- ==========================================
alter publication supabase_realtime add table guestbook_messages;
alter publication supabase_realtime add table guestbook_comments;
alter publication supabase_realtime add table guestbook_likes;

-- ==========================================
-- Done!
-- ==========================================
