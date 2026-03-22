-- ============================================
-- LOGIN SECURITY - PART 3: 记录登录失败函数
-- 在 Supabase SQL 编辑器中执行此文件
-- ============================================

-- 先删除旧版本函数（3个参数的版本）
DROP FUNCTION IF EXISTS public.record_login_failure(TEXT, INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.record_login_failure(
    user_email TEXT,
    max_attempts INTEGER DEFAULT 5,
    lockout_minutes INTEGER DEFAULT 15,
    client_ip TEXT DEFAULT NULL
)
RETURNS TABLE (
    attempts INTEGER,
    is_now_locked BOOLEAN,
    locked_until TIMESTAMP WITH TIME ZONE,
    ip_auto_blocked BOOLEAN
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_current_attempts INTEGER;
    v_locked_until TIMESTAMP WITH TIME ZONE := NULL;
    v_ip_blocked BOOLEAN := FALSE;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    SELECT au.id INTO v_user_id
    FROM auth.users au
    WHERE lower(COALESCE(au.email, '')) = lower(COALESCE(user_email, ''));
    
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT 0, FALSE, NULL::TIMESTAMP WITH TIME ZONE, FALSE;
        RETURN;
    END IF;
    
    UPDATE public.profiles p
    SET failed_login_attempts = COALESCE(p.failed_login_attempts, 0) + 1,
        last_login_ip = COALESCE(client_ip, p.last_login_ip)
    WHERE p.id = v_user_id
    RETURNING p.failed_login_attempts INTO v_current_attempts;
    
    IF v_current_attempts >= max_attempts THEN
        v_locked_until := NOW() + (lockout_minutes || ' minutes')::INTERVAL;
        
        UPDATE public.profiles p
        SET locked_until = v_locked_until
        WHERE p.id = v_user_id;
        
        IF client_ip IS NOT NULL THEN
            SELECT public.check_auto_blacklist_ip(client_ip) INTO v_ip_blocked;
        END IF;
        
        RETURN QUERY SELECT v_current_attempts, TRUE, v_locked_until, v_ip_blocked;
    ELSE
        RETURN QUERY SELECT v_current_attempts, FALSE, NULL::TIMESTAMP WITH TIME ZONE, FALSE;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_login_failure(TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_login_failure(TEXT, INTEGER, INTEGER, TEXT) TO service_role;
