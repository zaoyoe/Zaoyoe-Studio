-- ==========================================
-- Admin Feature Extensions Schema (CORRECTED & IDEMPOTENT)
-- 1. User Internal Notes
-- 2. Audit Logs
-- 3. System Notifications
-- ==========================================

-- 1. User Internal Notes (admin_notes)
create table if not exists public.admin_notes (
  id uuid default gen_random_uuid() primary key,
  target_user_id uuid references auth.users(id) on delete cascade not null,
  admin_id uuid references auth.users(id) on delete set null,
  content text not null,
  created_at timestamptz default now() not null
);

-- RLS
alter table public.admin_notes enable row level security;

drop policy if exists "Admins can view all notes" on public.admin_notes;
create policy "Admins can view all notes"
  on public.admin_notes for select
  using (public.is_admin());

drop policy if exists "Admins can insert notes" on public.admin_notes;
create policy "Admins can insert notes"
  on public.admin_notes for insert
  with check (public.is_admin());

drop policy if exists "Admins can delete notes" on public.admin_notes;
create policy "Admins can delete notes"
  on public.admin_notes for delete
  using (public.is_admin());

-- VIEW: admin_notes_view (Joins with profiles for email)
create or replace view public.admin_notes_view with (security_invoker = on) as
select 
  n.id,
  n.target_user_id,
  n.content,
  n.created_at,
  n.admin_id,
  p.email as admin_email
from public.admin_notes n
left join public.profiles p on n.admin_id = p.id;


-- 2. Admin Audit Logs (admin_audit_logs)
create table if not exists public.admin_audit_logs (
  id uuid default gen_random_uuid() primary key,
  admin_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  action_type text not null,
  details jsonb default '{}'::jsonb,
  created_at timestamptz default now() not null
);

-- RLS
alter table public.admin_audit_logs enable row level security;

drop policy if exists "Admins can view audit logs" on public.admin_audit_logs;
create policy "Admins can view audit logs"
  on public.admin_audit_logs for select
  using (public.is_admin());

drop policy if exists "Admins can insert audit logs" on public.admin_audit_logs;
create policy "Admins can insert audit logs"
  on public.admin_audit_logs for insert
  with check (public.is_admin());

drop policy if exists "Admins can delete audit logs" on public.admin_audit_logs;
create policy "Admins can delete audit logs"
  on public.admin_audit_logs for delete
  using (public.is_super_admin());

-- VIEW: admin_audit_logs_view
create or replace view public.admin_audit_logs_view with (security_invoker = on) as
select 
  l.id,
  l.action_type,
  l.details,
  l.created_at,
  l.target_user_id,
  l.admin_id,
  p.email as admin_email
from public.admin_audit_logs l
left join public.profiles p on l.admin_id = p.id;

  
-- 3. System Notifications (system_notifications)
create table if not exists public.system_notifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  content text,
  type text default 'info' check (type in ('info', 'warning', 'success', 'alert')),
  scope text default 'unspecified' not null check (scope in ('unspecified', 'user_personal', 'admin_personal')),
  category text default 'general' not null,
  is_read boolean default false,
  created_at timestamptz default now() not null
);

-- RLS
alter table public.system_notifications enable row level security;

drop policy if exists "Users can view own notifications" on public.system_notifications;
create policy "Users can view own notifications"
  on public.system_notifications for select
  using (
    auth.uid() = user_id
    and (
      scope <> 'admin_personal'
      or public.is_admin()
    )
  );

drop policy if exists "Admins can send notifications" on public.system_notifications;
create policy "Admins can send notifications"
  on public.system_notifications for insert
  with check (public.is_admin());

drop policy if exists "Users can update own notifications" on public.system_notifications;
create policy "Users can update own notifications"
  on public.system_notifications for update
  using (
    auth.uid() = user_id
    and (
      scope <> 'admin_personal'
      or public.is_admin()
    )
  );

drop policy if exists "Users can delete own notifications" on public.system_notifications;
create policy "Users can delete own notifications"
  on public.system_notifications for delete
  using (
    auth.uid() = user_id
    and (
      scope <> 'admin_personal'
      or public.is_admin()
    )
  );

-- ENABLE REALTIME
alter publication supabase_realtime add table system_notifications;

-- VIEW: admin_users_view (Exposes auth data safely to admins)
create or replace view public.admin_users_view with (security_invoker = on) as
select 
  au.id,
  au.email,
  au.created_at,
  au.last_sign_in_at,
  p.username,
  p.avatar_url
from auth.users au
left join public.profiles p on au.id = p.id;

-- Grant access to authenticated users (RLS will control actual visibility if you query the underlying tables directly, 
-- but for a view with security_invoker=on, it uses the invoker's permissions. 
-- Since auth.users is special, we might need a security defined function or just rely on the fact that we are super admin?
-- Actually, accessing auth.users directly via client view requires proper privileges.
-- A better approach for Supabase Client usage: define a view with security_definer NO, wait.
-- Standard pattern: Create a view owned by postgres/service_role and grant select to authenticated.
-- BUT auth.users is protected.
-- Alternative: Create a function `get_admin_users()` that returns the data security definer.

DROP FUNCTION IF EXISTS public.get_admin_users();

CREATE OR REPLACE FUNCTION public.get_admin_users()
RETURNS TABLE (
  out_id uuid,
  out_email varchar,
  out_created_at timestamptz,
  out_last_sign_in_at timestamptz,
  out_username text,
  out_avatar_url text,
  out_last_active_at timestamptz
) 
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_roles ar WHERE ar.user_id = auth.uid() AND ar.role_name = 'admin'
    UNION
    SELECT 1 FROM public.profiles pf WHERE pf.id = auth.uid() AND pf.email IN ('fjivvid@163.com', 'zaoyoe@gmail.com', 'ruihuashi620@gmail.com', 'wangyongchao802@gmail.com', '1012162759@qq.com')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH latest_activity AS (
    SELECT eua.user_id AS a_user_id, MAX(eua.last_active_at) AS last_active_at
    FROM public.engagement_user_activity eua
    GROUP BY eua.user_id
  )
  SELECT
    au.id AS out_id,
    au.email::varchar AS out_email,
    au.created_at AS out_created_at,
    au.last_sign_in_at AS out_last_sign_in_at,
    p.username AS out_username,
    p.avatar_url AS out_avatar_url,
    la.last_active_at AS out_last_active_at
  FROM auth.users au
  LEFT JOIN public.profiles p ON au.id = p.id
  LEFT JOIN latest_activity la ON au.id = la.a_user_id
  ORDER BY la.last_active_at DESC NULLS LAST, au.created_at DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql;
