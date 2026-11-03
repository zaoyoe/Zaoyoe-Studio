-- Read-only administrator identity and role evidence for the supplier-catalog acceptance.
-- Target: Supabase project zaoyoe / main PRODUCTION only.
-- This file must never be used as a migration and must not be changed to write data.

BEGIN TRANSACTION READ ONLY;

SELECT jsonb_pretty(jsonb_build_object(
    'database', current_database(),
    'server_version', current_setting('server_version'),
    'target_project_ref', 'mmkugdibsaeoevliebzk',
    'target_environment', 'main PRODUCTION'
)) AS target;

SELECT
    u.id,
    u.email,
    u.confirmed_at,
    u.last_sign_in_at,
    u.banned_until,
    EXISTS (
        SELECT 1
        FROM public.admin_roles AS ar
        WHERE ar.user_id = u.id
    ) AS has_admin_role,
    (
        SELECT jsonb_agg(jsonb_build_object(
            'role_name', ar.role_name,
            'permissions', ar.permissions,
            'expires_at', ar.expires_at
        ) ORDER BY ar.role_name)
        FROM public.admin_roles AS ar
        WHERE ar.user_id = u.id
    ) AS admin_roles
FROM auth.users AS u
WHERE u.id = '2e69a374-b00e-41e7-bcc4-27e055470040'::uuid;

SELECT
    ar.user_id,
    ar.role_name,
    ar.permissions,
    ar.expires_at
FROM public.admin_roles AS ar
WHERE ar.user_id = '2e69a374-b00e-41e7-bcc4-27e055470040'::uuid
ORDER BY ar.role_name;

ROLLBACK;
