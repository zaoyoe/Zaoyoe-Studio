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

-- RLS 策略：仅 Super Admin 可管理
DROP POLICY IF EXISTS "Super admin can view roles" ON public.admin_roles;
CREATE POLICY "Super admin can view roles"
ON public.admin_roles FOR SELECT
USING (public.is_admin());

DROP POLICY IF EXISTS "Super admin can manage roles" ON public.admin_roles;
CREATE POLICY "Super admin can manage roles"
ON public.admin_roles FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM auth.users 
        WHERE id = auth.uid() 
        AND email IN ('fjivvid@163.com', 'zaoyoe@gmail.com')
    )
);

-- 2. 创建 is_super_admin() 函数
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM auth.users 
        WHERE id = auth.uid() 
        AND email IN ('fjivvid@163.com', 'zaoyoe@gmail.com')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. 更新 is_admin() 函数（支持动态管理员）
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    -- Super Admin（硬编码邮箱）
    IF public.is_super_admin() THEN
        RETURN TRUE;
    END IF;
    
    -- 动态 Admin（从 admin_roles 表查询，检查到期时间）
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
    -- Super Admin 拥有所有权限
    IF public.is_super_admin() THEN
        RETURN TRUE;
    END IF;
    
    -- 检查用户是否有特定权限
    RETURN EXISTS (
        SELECT 1 FROM public.admin_roles 
        WHERE user_id = auth.uid()
        AND permissions @> jsonb_build_array(p_permission)
        AND (expires_at IS NULL OR expires_at > NOW())
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. 创建获取用户权限的函数
CREATE OR REPLACE FUNCTION public.get_user_permissions(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'is_super_admin', EXISTS (
            SELECT 1 FROM auth.users 
            WHERE id = p_user_id 
            AND email IN ('fjivvid@163.com', 'zaoyoe@gmail.com')
        ),
        'is_admin', EXISTS (
            SELECT 1 FROM public.admin_roles 
            WHERE user_id = p_user_id
            AND (expires_at IS NULL OR expires_at > NOW())
        ),
        'role', (SELECT role_name FROM public.admin_roles WHERE user_id = p_user_id),
        'permissions', COALESCE(
            (SELECT permissions FROM public.admin_roles WHERE user_id = p_user_id),
            '[]'::jsonb
        ),
        'expires_at', (SELECT expires_at FROM public.admin_roles WHERE user_id = p_user_id)
    ) INTO v_result;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 授权
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_permissions(UUID) TO authenticated;
