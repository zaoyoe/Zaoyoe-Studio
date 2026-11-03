-- Minimal read-only role lookup using text comparison for diagnostic clarity.
-- Target: Supabase project zaoyoe / main PRODUCTION only.
-- This file must never be used as a migration and must not be changed to write data.

SELECT
    user_id::text AS observed_user_id,
    role_name,
    permissions,
    expires_at
FROM public.admin_roles
WHERE user_id::text = '2e69a374-b00e-41e7-bcc4-27e055470040'
ORDER BY role_name;
