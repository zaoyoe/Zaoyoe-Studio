-- ============================================
-- LOGIN SECURITY - PART 4: 其他函数
-- 在 Supabase SQL 编辑器中执行此文件
-- ============================================

-- Reset login failures
CREATE OR REPLACE FUNCTION public.reset_login_failures(user_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    SELECT au.id INTO v_user_id
    FROM auth.users au
    WHERE au.email = user_email;
    
    IF v_user_id IS NOT NULL THEN
        UPDATE public.profiles p
        SET failed_login_attempts = 0, locked_until = NULL
        WHERE p.id = v_user_id;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_login_failures TO authenticated;

-- Admin unlock single account
CREATE OR REPLACE FUNCTION public.admin_unlock_account(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    
    UPDATE public.profiles
    SET failed_login_attempts = 0, locked_until = NULL
    WHERE id = target_user_id;
    
    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_unlock_account TO authenticated;

-- Admin unlock all accounts
CREATE OR REPLACE FUNCTION public.admin_unlock_all_accounts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;
    
    SELECT COUNT(*) INTO v_count
    FROM public.profiles
    WHERE locked_until IS NOT NULL AND locked_until > NOW();
    
    UPDATE public.profiles
    SET failed_login_attempts = 0, locked_until = NULL
    WHERE locked_until IS NOT NULL;
    
    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_unlock_all_accounts TO authenticated;

-- Get public security config
CREATE OR REPLACE FUNCTION public.get_public_security_config()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_config JSONB;
BEGIN
    SELECT config_value INTO v_config
    FROM public.system_config
    WHERE config_key = 'security';
    
    RETURN COALESCE(v_config, jsonb_build_object(
        'login_lockout_attempts', 5,
        'lockout_duration', 900000,
        'session_timeout', 3600000
    ));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_security_config TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_security_config TO authenticated;
