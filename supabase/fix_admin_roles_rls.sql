-- Fix the infinite loop / read-blocking issue on admin_roles:
-- A user needs to be able to read their own admin role to know they are an admin.
-- The current policy "Super admin can view roles" requires is_admin(), which queries admin_roles.

DROP POLICY IF EXISTS "Users can view their own admin role" ON public.admin_roles;
CREATE POLICY "Users can view their own admin role"
ON public.admin_roles FOR SELECT
USING (user_id = auth.uid());
