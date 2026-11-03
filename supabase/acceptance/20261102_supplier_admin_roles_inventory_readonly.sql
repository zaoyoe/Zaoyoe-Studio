-- Read-only administrator role inventory for the supplier-catalog acceptance.
-- Target: Supabase project zaoyoe / main PRODUCTION only.
-- This file must never be used as a migration and must not be changed to write data.

BEGIN TRANSACTION READ ONLY;

SELECT jsonb_pretty(jsonb_build_object(
    'target_project_ref', 'mmkugdibsaeoevliebzk',
    'target_environment', 'main PRODUCTION',
    'admin_role_count', (SELECT count(*) FROM public.admin_roles),
    'admin_roles', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'user_id', ar.user_id,
            'email', u.email,
            'role_name', ar.role_name,
            'permissions', ar.permissions,
            'expires_at', ar.expires_at
        ) ORDER BY u.email NULLS LAST, ar.role_name)
        FROM public.admin_roles AS ar
        LEFT JOIN auth.users AS u ON u.id = ar.user_id
    ), '[]'::jsonb)
)) AS administrator_role_inventory;

ROLLBACK;
