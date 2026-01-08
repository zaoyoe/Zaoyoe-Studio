-- FUNCTION: get_admin_users (Enhanced Activity Tracking)
-- Updates the backend logic to consider comments and ledger activity as "Active" status

CREATE OR REPLACE FUNCTION public.get_admin_users()
RETURNS TABLE (
  id uuid,
  email varchar,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  username text,
  avatar_url text,
  last_active_at timestamptz -- NEW: Computed latest activity
) 
SECURITY DEFINER
AS $$
BEGIN
  -- Perform Admin Check
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid() AND role_name = 'admin'
    UNION 
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND email IN ('fjivvid@163.com', 'zaoyoe@gmail.com')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH 
  -- 1. Latest Comment Time per User
  latest_comments AS (
    SELECT user_id, MAX(created_at) as last_comment_at 
    FROM public.prompt_comments 
    GROUP BY user_id
  ),
  -- 2. Latest Ledger Activity per User
  latest_ledger AS (
    SELECT user_id, MAX(created_at) as last_ledger_at
    FROM public.points_ledger
    GROUP BY user_id
  )
  SELECT 
    au.id,
    au.email::varchar,
    au.created_at,
    au.last_sign_in_at,
    p.username,
    p.avatar_url,
    -- Compute the latest timestamp from all sources
    GREATEST(
        COALESCE(au.last_sign_in_at, au.created_at), 
        lc.last_comment_at, 
        ll.last_ledger_at
    ) as last_active_at
  FROM auth.users au
  LEFT JOIN public.profiles p ON au.id = p.id
  LEFT JOIN latest_comments lc ON au.id = lc.user_id
  LEFT JOIN latest_ledger ll ON au.id = ll.user_id
  ORDER BY GREATEST(
        COALESCE(au.last_sign_in_at, au.created_at), 
        lc.last_comment_at, 
        ll.last_ledger_at
    ) DESC; 
END;
$$ LANGUAGE plpgsql;
