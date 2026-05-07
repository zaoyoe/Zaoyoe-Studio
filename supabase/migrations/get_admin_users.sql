-- FUNCTION: get_admin_users (Heartbeat-backed Activity Tracking)

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
