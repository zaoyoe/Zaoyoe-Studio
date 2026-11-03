-- Read-only administrator identity snapshot for the supplier-catalog acceptance.
-- Target: Supabase project zaoyoe / main PRODUCTION only.
-- This file must never be used as a migration and must not be changed to write data.

BEGIN TRANSACTION READ ONLY;

SELECT jsonb_pretty(jsonb_build_object(
    'target', jsonb_build_object(
        'database', current_database(),
        'server_version', current_setting('server_version'),
        'target_project_ref', 'mmkugdibsaeoevliebzk',
        'target_environment', 'main PRODUCTION'
    ),
    'user', (
        SELECT to_jsonb(u)
        FROM auth.users AS u
        WHERE u.id = '2e69a374-b00e-41e7-bcc4-27e055470040'::uuid
    ),
    'admin_roles', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'user_id', ar.user_id,
            'role_name', ar.role_name,
            'permissions', ar.permissions,
            'expires_at', ar.expires_at
        ) ORDER BY ar.role_name)
        FROM public.admin_roles AS ar
        WHERE ar.user_id = '2e69a374-b00e-41e7-bcc4-27e055470040'::uuid
    ), '[]'::jsonb)
)) AS administrator_identity_snapshot;

ROLLBACK;
