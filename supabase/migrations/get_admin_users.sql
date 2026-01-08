-- FUNCTION: get_admin_users (Enhanced Activity Tracking)
-- Renames output columns to avoid PL/pgSQL variable conflicts

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
  -- Perform Admin Check
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_roles ar WHERE ar.user_id = auth.uid() AND ar.role_name = 'admin'
    UNION 
    SELECT 1 FROM public.profiles pf WHERE pf.id = auth.uid() AND pf.email IN ('fjivvid@163.com', 'zaoyoe@gmail.com', 'ruihuashi620@gmail.com', 'wangyongchao802@gmail.com', '1012162759@qq.com')
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  WITH 
  latest_comments AS (
    SELECT pc.user_id AS c_user_id, MAX(pc.created_at) AS last_comment_at 
    FROM public.prompt_comments pc
    GROUP BY pc.user_id
  ),
  latest_ledger AS (
    SELECT pl.user_id AS l_user_id, MAX(pl.created_at) AS last_ledger_at
    FROM public.points_ledger pl
    GROUP BY pl.user_id
  )
  SELECT 
    au.id AS out_id,
    au.email::varchar AS out_email,
    au.created_at AS out_created_at,
    au.last_sign_in_at AS out_last_sign_in_at,
    p.username AS out_username,
    p.avatar_url AS out_avatar_url,
    GREATEST(
        COALESCE(au.last_sign_in_at, au.created_at), 
        lc.last_comment_at, 
        ll.last_ledger_at
    ) AS out_last_active_at
  FROM auth.users au
  LEFT JOIN public.profiles p ON au.id = p.id
  LEFT JOIN latest_comments lc ON au.id = lc.c_user_id
  LEFT JOIN latest_ledger ll ON au.id = ll.l_user_id
  ORDER BY GREATEST(
        COALESCE(au.last_sign_in_at, au.created_at), 
        lc.last_comment_at, 
        ll.last_ledger_at
    ) DESC NULLS LAST; 
END;
$$ LANGUAGE plpgsql;
