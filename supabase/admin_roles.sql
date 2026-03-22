-- ============================================
-- 管理员角色分配系统
-- 2级管理员 + 权限到期功能
-- ============================================

-- 1. 创建 admin_roles 表
CREATE TABLE IF NOT EXISTS public.admin_roles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE NOT NULL,
    role_name TEXT NOT NULL DEFAULT 'admin',
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    granted_by UUID REFERENCES public.profiles(id),
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ, -- 权限到期时间
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_admin_roles_user_id ON public.admin_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_roles_expires_at ON public.admin_roles(expires_at);

-- 启用 RLS
ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;

-- 兼容旧版白名单：首次切换到角色制时，把历史超级管理员回填进 admin_roles
INSERT INTO public.admin_roles (user_id, role_name, permissions, notes)
SELECT
    au.id,
    'super_admin',
    jsonb_build_array('*'),
    'Backfilled from legacy hardcoded allowlist'
FROM auth.users au
JOIN public.profiles p ON p.id = au.id
WHERE lower(COALESCE(au.email, '')) IN ('fjivvid@163.com', 'zaoyoe@gmail.com')
ON CONFLICT (user_id) DO UPDATE SET
    role_name = CASE
        WHEN public.admin_roles.role_name = 'super_admin' THEN public.admin_roles.role_name
        ELSE 'super_admin'
    END,
    permissions = CASE
        WHEN COALESCE(public.admin_roles.permissions, '[]'::jsonb) @> jsonb_build_array('*')
            THEN COALESCE(public.admin_roles.permissions, '[]'::jsonb)
        ELSE COALESCE(public.admin_roles.permissions, '[]'::jsonb) || jsonb_build_array('*')
    END,
    notes = COALESCE(public.admin_roles.notes, EXCLUDED.notes);

-- RLS 策略：仅 Super Admin 可管理
DROP POLICY IF EXISTS "Super admin can view roles" ON public.admin_roles;
CREATE POLICY "Super admin can view roles"
ON public.admin_roles FOR SELECT
USING (public.is_admin());

DROP POLICY IF EXISTS "Super admin can manage roles" ON public.admin_roles;
CREATE POLICY "Super admin can manage roles"
ON public.admin_roles FOR ALL
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

-- 2. 创建 is_super_admin() 函数
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.admin_roles
        WHERE user_id = auth.uid()
          AND (expires_at IS NULL OR expires_at > NOW())
          AND (
              role_name = 'super_admin'
              OR COALESCE(permissions, '[]'::jsonb) @> jsonb_build_array('*')
          )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 更新 is_admin() 函数（支持动态管理员）
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.admin_roles
        WHERE user_id = auth.uid()
        AND (expires_at IS NULL OR expires_at > NOW())
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. 创建权限检查函数
CREATE OR REPLACE FUNCTION public.has_permission(p_permission TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF public.is_super_admin() THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM public.admin_roles
        WHERE user_id = auth.uid()
        AND (
            COALESCE(permissions, '[]'::jsonb) @> jsonb_build_array(p_permission)
            OR COALESCE(permissions, '[]'::jsonb) @> jsonb_build_array('*')
        )
        AND (expires_at IS NULL OR expires_at > NOW())
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. 创建获取用户权限的函数
CREATE OR REPLACE FUNCTION public.get_user_permissions(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_role RECORD;
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_request_is_admin BOOLEAN := FALSE;
    v_effective_user_id UUID;
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RAISE EXCEPTION 'auth required';
        END IF;

        v_request_is_admin := public.is_admin();
        IF p_user_id IS NOT NULL AND p_user_id <> v_request_user_id AND NOT v_request_is_admin THEN
            RAISE EXCEPTION 'Access denied';
        END IF;

        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    END IF;

    IF v_effective_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id required';
    END IF;

    SELECT
        role_name,
        COALESCE(permissions, '[]'::jsonb) AS permissions,
        expires_at
    INTO v_role
    FROM public.admin_roles
    WHERE user_id = v_effective_user_id
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY
        CASE WHEN role_name = 'super_admin' THEN 0 ELSE 1 END,
        granted_at DESC NULLS LAST,
        created_at DESC NULLS LAST
    LIMIT 1;

    RETURN jsonb_build_object(
        'is_super_admin', COALESCE(v_role.role_name = 'super_admin' OR v_role.permissions @> jsonb_build_array('*'), FALSE),
        'is_admin', v_role.role_name IS NOT NULL,
        'role', v_role.role_name,
        'permissions', COALESCE(v_role.permissions, '[]'::jsonb),
        'expires_at', v_role.expires_at
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

-- 授权
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.get_user_permissions(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_permissions(UUID) TO authenticated, service_role;
