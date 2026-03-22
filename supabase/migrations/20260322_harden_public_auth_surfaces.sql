-- ============================================
-- Harden public auth surfaces against enumeration and account-lock abuse
-- 收紧匿名登录侧的邮箱枚举与远程锁号面
-- ============================================

CREATE OR REPLACE FUNCTION public.check_user_locked(user_email TEXT)
RETURNS TABLE (
    is_locked BOOLEAN,
    locked_until TIMESTAMP WITH TIME ZONE,
    remaining_seconds INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
    v_user_id UUID;
    v_locked_until TIMESTAMP WITH TIME ZONE;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    SELECT au.id INTO v_user_id
    FROM auth.users au
    WHERE lower(COALESCE(au.email, '')) = lower(COALESCE(user_email, ''));

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
AS $func$
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
$func$;

CREATE OR REPLACE FUNCTION public.reset_login_failures(user_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_target_user_id UUID;
BEGIN
    IF v_request_role = 'service_role' THEN
        SELECT au.id INTO v_target_user_id
        FROM auth.users au
        WHERE lower(COALESCE(au.email, '')) = lower(COALESCE(user_email, ''));
    ELSE
        IF v_request_user_id IS NULL THEN
            RAISE EXCEPTION 'auth required';
        END IF;

        SELECT au.id INTO v_target_user_id
        FROM auth.users au
        WHERE au.id = v_request_user_id
          AND (
              user_email IS NULL
              OR lower(COALESCE(au.email, '')) = lower(COALESCE(user_email, ''))
          );
    END IF;

    IF v_target_user_id IS NOT NULL THEN
        UPDATE public.profiles p
        SET failed_login_attempts = 0, locked_until = NULL
        WHERE p.id = v_target_user_id;
    END IF;
END;
$func$;

CREATE OR REPLACE FUNCTION public.fn_check_email_exists(check_email TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM auth.users WHERE lower(email) = lower(check_email)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.check_ip_blacklisted(client_ip TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
    v_manual_list JSONB;
    v_entry TEXT;
    v_auto_blocked RECORD;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    SELECT * INTO v_auto_blocked
    FROM public.ip_blacklist
    WHERE ip_address = client_ip
      AND (expires_at IS NULL OR expires_at > NOW());

    IF FOUND THEN
        RETURN jsonb_build_object(
            'blocked', TRUE,
            'reason', COALESCE(v_auto_blocked.reason, '自动拉黑'),
            'expires_at', v_auto_blocked.expires_at
        );
    END IF;

    SELECT config_value->'ip_blacklist' INTO v_manual_list
    FROM public.system_config
    WHERE config_key = 'security';

    IF v_manual_list IS NOT NULL THEN
        FOR v_entry IN SELECT jsonb_array_elements_text(v_manual_list)
        LOOP
            IF v_entry LIKE '%/%' THEN
                BEGIN
                    IF inet(client_ip) <<= inet(v_entry) THEN
                        RETURN jsonb_build_object(
                            'blocked', TRUE,
                            'reason', '手动黑名单 (CIDR: ' || v_entry || ')',
                            'expires_at', NULL
                        );
                    END IF;
                EXCEPTION WHEN OTHERS THEN
                    NULL;
                END;
            ELSE
                IF client_ip = v_entry THEN
                    RETURN jsonb_build_object(
                        'blocked', TRUE,
                        'reason', '手动黑名单',
                        'expires_at', NULL
                    );
                END IF;
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object('blocked', FALSE);
END;
$func$;

CREATE OR REPLACE FUNCTION public.check_auto_blacklist_ip(p_ip TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
    v_lockout_count INTEGER;
    v_already_blocked BOOLEAN;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.ip_blacklist
        WHERE ip_address = p_ip
          AND (expires_at IS NULL OR expires_at > NOW())
    ) INTO v_already_blocked;

    IF v_already_blocked THEN
        RETURN FALSE;
    END IF;

    SELECT COUNT(*) INTO v_lockout_count
    FROM public.profiles
    WHERE last_login_ip = p_ip
      AND locked_until IS NOT NULL
      AND locked_until > NOW() - INTERVAL '15 minutes';

    IF v_lockout_count >= 3 THEN
        INSERT INTO public.ip_blacklist (ip_address, reason, expires_at)
        VALUES (
            p_ip,
            '自动拉黑: 15分钟内触发 ' || v_lockout_count || ' 次账户锁定',
            NOW() + INTERVAL '24 hours'
        );
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$func$;

REVOKE ALL ON FUNCTION public.fn_check_email_exists(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_check_email_exists(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.check_ip_blacklisted(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_ip_blacklisted(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.check_user_locked(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_user_locked(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.record_login_failure(TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_login_failure(TEXT, INTEGER, INTEGER, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.reset_login_failures(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_login_failures(TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.check_auto_blacklist_ip(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_auto_blacklist_ip(TEXT) TO service_role;
