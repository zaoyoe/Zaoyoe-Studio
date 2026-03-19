-- Login Security Schema
-- Add fields to profiles table for login security

-- 1. Add security columns to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- 2. Create index for email lookup (via auth.users join)
CREATE INDEX IF NOT EXISTS idx_profiles_locked_until ON public.profiles(locked_until);

-- 3. Function to check if a user is locked
CREATE OR REPLACE FUNCTION public.check_user_locked(user_email TEXT)
RETURNS TABLE (
    is_locked BOOLEAN,
    locked_until TIMESTAMP WITH TIME ZONE,
    remaining_seconds INTEGER
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
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
$func$;

-- 4. Function to record login failure (with IP tracking for auto-blacklist)
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
AS $func$
DECLARE
    v_user_id UUID;
    v_current_attempts INTEGER;
    v_locked_until TIMESTAMP WITH TIME ZONE := NULL;
    v_ip_blocked BOOLEAN := FALSE;
BEGIN
    SELECT au.id INTO v_user_id
    FROM auth.users au
    WHERE au.email = user_email;
    
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
$func$;

-- 5. Function to reset login failures after successful login
CREATE OR REPLACE FUNCTION public.reset_login_failures(user_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
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
$func$;

-- 6. Admin function to unlock any account (super admin only)
CREATE OR REPLACE FUNCTION public.admin_unlock_account(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Unauthorized: only super admins can unlock accounts';
    END IF;
    
    UPDATE public.profiles
    SET failed_login_attempts = 0, locked_until = NULL
    WHERE id = target_user_id;
    
    RETURN TRUE;
END;
$func$;

-- 7. Admin function to unlock all accounts (super admin only)
CREATE OR REPLACE FUNCTION public.admin_unlock_all_accounts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
    v_count INTEGER := 0;
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Unauthorized: only super admins can unlock accounts';
    END IF;
    
    SELECT COUNT(*) INTO v_count
    FROM public.profiles
    WHERE locked_until IS NOT NULL AND locked_until > NOW();
    
    UPDATE public.profiles
    SET failed_login_attempts = 0, locked_until = NULL
    WHERE locked_until IS NOT NULL;
    
    RETURN v_count;
END;
$func$;

-- 8. Grant execute permissions to anon (for pre-login checks)
GRANT EXECUTE ON FUNCTION public.check_user_locked TO anon;
GRANT EXECUTE ON FUNCTION public.record_login_failure TO anon;
GRANT EXECUTE ON FUNCTION public.reset_login_failures TO authenticated;

-- 9. Public RPC to get security config (for anon users during login)
CREATE OR REPLACE FUNCTION public.get_public_security_config()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
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
$func$;

-- 10. Grant permissions
GRANT EXECUTE ON FUNCTION public.get_public_security_config TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_security_config TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unlock_account TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unlock_all_accounts TO authenticated;
