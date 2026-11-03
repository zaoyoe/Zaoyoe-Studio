-- Minimal read-only administrator identity check.
-- Target: Supabase project zaoyoe / main PRODUCTION only.
-- This file must never be used as a migration and must not be changed to write data.

SELECT
    '2e69a374-b00e-41e7-bcc4-27e055470040'::uuid AS target_user_id,
    EXISTS (
        SELECT 1
        FROM auth.users
        WHERE id = '2e69a374-b00e-41e7-bcc4-27e055470040'::uuid
    ) AS auth_user_exists,
    EXISTS (
        SELECT 1
        FROM public.admin_roles
        WHERE user_id = '2e69a374-b00e-41e7-bcc4-27e055470040'::uuid
    ) AS admin_role_exists,
    (
        SELECT role_name
        FROM public.admin_roles
        WHERE user_id = '2e69a374-b00e-41e7-bcc4-27e055470040'::uuid
        ORDER BY role_name
        LIMIT 1
    ) AS first_role_name;
