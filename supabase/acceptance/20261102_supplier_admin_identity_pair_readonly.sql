-- Final read-only comparison of the stale session subject and the observed
-- administrator role identity.
-- Target: Supabase project zaoyoe / main PRODUCTION only.
-- This file must never be used as a migration and must not be changed to write data.

BEGIN TRANSACTION READ ONLY;

WITH ids(label, user_id) AS (
    VALUES
        ('session_token_sub'::text, '2e69a374-b00e-41e7-bcc4-27e055470040'::uuid),
        ('admin_role_user_id'::text, '2e69a374-b00e-41e8-bcc4-27e055470040'::uuid)
)
SELECT
    ids.label,
    ids.user_id::text AS user_id,
    EXISTS (
        SELECT 1
        FROM auth.users AS u
        WHERE u.id = ids.user_id
    ) AS auth_user_exists,
    COALESCE(string_agg(ar.role_name, ',' ORDER BY ar.role_name), '') AS roles
FROM ids
LEFT JOIN public.admin_roles AS ar ON ar.user_id = ids.user_id
GROUP BY ids.label, ids.user_id
ORDER BY ids.label;

ROLLBACK;
