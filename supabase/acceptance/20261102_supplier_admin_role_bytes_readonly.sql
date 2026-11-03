-- Read-only diagnostic of administrator role identifier bytes.
-- Target: Supabase project zaoyoe / main PRODUCTION only.
-- This file must never be used as a migration and must not be changed to write data.

SELECT
    user_id::text AS observed_user_id,
    length(user_id::text) AS observed_length,
    encode(convert_to(user_id::text, 'UTF8'), 'hex') AS observed_utf8_hex,
    role_name
FROM public.admin_roles
WHERE role_name = 'super_admin'
ORDER BY user_id::text;
