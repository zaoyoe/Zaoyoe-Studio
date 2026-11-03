-- Read-only administrator identity evidence for the supplier-catalog acceptance.
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
    ar.role_name,
    ar.permissions,
    ar.expires_at
FROM auth.users AS u
LEFT JOIN public.admin_roles AS ar ON ar.user_id = u.id
WHERE u.id = '2e69a374-b00e-41e7-bcc4-27e055470040'::uuid
ORDER BY ar.role_name NULLS LAST;

SELECT public.get_user_permissions(
    '2e69a374-b00e-41e7-bcc4-27e055470040'::uuid
) AS permission_snapshot;

ROLLBACK;
