-- ============================================
-- LOGIN SECURITY - PART 2: 检查锁定函数
-- 在 Supabase SQL 编辑器中执行此文件
-- ============================================

CREATE OR REPLACE FUNCTION public.check_user_locked(user_email TEXT)
RETURNS TABLE (
    is_locked BOOLEAN,
    locked_until TIMESTAMP WITH TIME ZONE,
    remaining_seconds INTEGER
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_locked_until TIMESTAMP WITH TIME ZONE;
BEGIN
    SELECT au.id INTO v_user_id
    FROM auth.users au
    WHERE au.email = user_email;
    
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::TIMESTAMP WITH TIME ZONE, 0;
        RETURN;
    END IF;
    
    SELECT p.locked_until INTO v_locked_until
    FROM public.profiles p
    WHERE p.id = v_user_id;
    
    IF v_locked_until IS NOT NULL AND v_locked_until > NOW() THEN
        RETURN QUERY SELECT 
            TRUE,
            v_locked_until,
            EXTRACT(EPOCH FROM (v_locked_until - NOW()))::INTEGER;
    ELSE
        RETURN QUERY SELECT FALSE, NULL::TIMESTAMP WITH TIME ZONE, 0;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_user_locked TO anon;
