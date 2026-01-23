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

-- Create Policies (Adjust as needed for production)

-- 1. Allow anyone to insert messages (Guests need to send messages)
create policy "Public insert access" 
on chat_messages for insert 
with check (true);

-- 2. Allow users to read messages from their own session or if they are the owner
create policy "Read own session messages" 
on chat_messages for select 
using (
    session_id = current_setting('request.headers', true)::json->>'x-session-id' -- If we passed header, but we aren't yet
    or 
    true -- For MVP, allow public read to debug real-time. 
    -- PRODUCTION: Change 'true' to: (auth.uid() = user_id) OR (session_id IS NOT NULL)
);

-- Note: For Realtime to work with RLS, the subscription filter must match the policy visibility.
-- For now, we set read policy to 'true' (public) for simplicity during development. 
-- In production, you would restrict this to only the user's own messages.
