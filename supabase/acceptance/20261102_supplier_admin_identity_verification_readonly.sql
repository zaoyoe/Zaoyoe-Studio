-- Read-only verification of the administrator identity used by the local session.
-- Target: Supabase project zaoyoe / main PRODUCTION only.
-- This file must never be used as a migration and must not be changed to write data.

BEGIN TRANSACTION READ ONLY;

SELECT jsonb_pretty(jsonb_build_object(
    'target_project_ref', 'mmkugdibsaeoevliebzk',
    'target_environment', 'main PRODUCTION',
    'user_id', '2e69a374-b00e-41e7-bcc4-27e055470040',
    'auth_user_exists', EXISTS (
        SELECT 1
        FROM auth.users AS u
        WHERE u.id = '2e69a374-b00e-41e7-bcc4-27e055470040'::uuid
    ),
    'admin_role_matches', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'role_name', ar.role_name,
            'permissions', ar.permissions,
            'expires_at', ar.expires_at
        ) ORDER BY ar.role_name)
        FROM public.admin_roles AS ar
        WHERE ar.user_id = '2e69a374-b00e-41e7-bcc4-27e055470040'::uuid
    ), '[]'::jsonb)
)) AS administrator_identity_verification;

ROLLBACK;
