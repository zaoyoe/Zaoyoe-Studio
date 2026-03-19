-- Create chat_messages table
create table if not exists chat_messages (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id), -- Can be null for guest users
  session_id text, -- Used to track guest sessions
  content text not null,
  message_type text check (message_type in ('text', 'image')) default 'text',
  is_admin boolean default false,
  created_at timestamptz default now()
);

-- Enable Row Level Security
alter table chat_messages enable row level security;

-- Helper: read visitor chat session from request header
create or replace function public.current_chat_session_id()
returns text
language sql
stable
as $$
  select nullif(((current_setting('request.headers', true))::jsonb ->> 'x-session-id'), '');
$$;

grant execute on function public.current_chat_session_id() to anon, authenticated;

create or replace function public.authenticated_chat_session_id(p_user_id uuid default auth.uid())
returns text
language sql
stable
as $$
  select case
    when p_user_id is null then null
    else 'user_' || p_user_id::text
  end;
$$;

grant execute on function public.authenticated_chat_session_id(uuid) to authenticated;

-- Helper: safely evaluate admin status for both anon and authenticated requests
create or replace function public.is_chat_admin()
returns boolean
language plpgsql
security definer
as $$
begin
  if auth.role() <> 'authenticated' then
    return false;
  end if;

  return public.is_admin();
end;
$$;

grant execute on function public.is_chat_admin() to anon, authenticated;

-- Create Policies

drop policy if exists "Public insert access" on chat_messages;
drop policy if exists "Read own session messages" on chat_messages;
drop policy if exists "Public read access" on chat_messages;
drop policy if exists "Users can read their own chat messages" on chat_messages;
drop policy if exists "Users can insert their own chat messages" on chat_messages;

create policy "Users can read their own chat messages"
on chat_messages for select
using (
    public.is_chat_admin()
    or (user_id is not null and auth.uid() = user_id)
    or (
        auth.uid() is not null
        and session_id = public.authenticated_chat_session_id()
    )
    or (
        coalesce(auth.jwt() ->> 'email', '') <> ''
        and lower(coalesce(session_id, '')) = lower(auth.jwt() ->> 'email')
    )
    or (
        auth.uid() is null
        and public.current_chat_session_id() is not null
        and session_id = public.current_chat_session_id()
    )
);

create policy "Users can insert their own chat messages"
on chat_messages for insert
with check (
    (
        public.is_chat_admin()
        and is_admin = true
    )
    or (
        is_admin = false
        and auth.uid() is not null
        and user_id = auth.uid()
        and session_id = public.authenticated_chat_session_id()
    )
    or (
        is_admin = false
        and auth.uid() is null
        and user_id is null
        and public.current_chat_session_id() is not null
        and session_id = public.current_chat_session_id()
    )
);

-- Realtime subscriptions now rely on:
-- 1. Authenticated users reading their own user_id-scoped sessions
-- 2. Guests carrying x-session-id in the browser Supabase client
-- 3. Admins passing public.is_chat_admin()
