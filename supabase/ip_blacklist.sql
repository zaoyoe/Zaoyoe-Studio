-- ============================================
-- IP BLACKLIST FUNCTIONS
-- IP 黑名单功能
-- ============================================

-- 1. Add last_login_ip column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_login_ip TEXT;

-- 2. Create ip_blacklist table for auto-blocked IPs
CREATE TABLE IF NOT EXISTS public.ip_blacklist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_address TEXT NOT NULL,
    reason TEXT,
    blocked_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    is_permanent BOOLEAN DEFAULT FALSE,
    created_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_ip_blacklist_ip ON public.ip_blacklist(ip_address);
CREATE INDEX IF NOT EXISTS idx_ip_blacklist_expires ON public.ip_blacklist(expires_at) WHERE expires_at IS NOT NULL;

-- RLS for ip_blacklist
ALTER TABLE public.ip_blacklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage ip_blacklist" ON public.ip_blacklist;

CREATE POLICY "Admins can manage ip_blacklist" ON public.ip_blacklist
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- 3. Check if IP is blacklisted (supports manual list + auto-blocked + CIDR)
CREATE OR REPLACE FUNCTION public.check_ip_blacklisted(client_ip TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_manual_list JSONB;
    v_entry TEXT;
    v_auto_blocked RECORD;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    -- Check auto-blocked table first
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
    
    -- Check manual blacklist from config
    SELECT config_value->'ip_blacklist' INTO v_manual_list
    FROM public.system_config
    WHERE config_key = 'security';
    
    IF v_manual_list IS NOT NULL THEN
        FOR v_entry IN SELECT jsonb_array_elements_text(v_manual_list)
        LOOP
            IF v_entry LIKE '%/%' THEN
                -- CIDR notation
                BEGIN
                    IF inet(client_ip) <<= inet(v_entry) THEN
                        RETURN jsonb_build_object(
                            'blocked', TRUE,
                            'reason', '手动黑名单 (CIDR: ' || v_entry || ')',
                            'expires_at', NULL
                        );
                    END IF;
                EXCEPTION WHEN OTHERS THEN
                    -- Invalid CIDR, skip
                    NULL;
                END;
            ELSE
                -- Exact match
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
$$;

-- 4. Record login IP and check for auto-blacklist trigger
CREATE OR REPLACE FUNCTION public.record_login_ip(p_user_id UUID, p_ip TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Update user's last login IP
    UPDATE public.profiles
    SET last_login_ip = p_ip
    WHERE id = p_user_id;
END;
$$;

-- 5. Check and auto-blacklist IP (called when account gets locked)
-- Rule: 3+ lockouts from same IP in 15 minutes = 24 hour ban
CREATE OR REPLACE FUNCTION public.check_auto_blacklist_ip(p_ip TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_lockout_count INTEGER;
    v_already_blocked BOOLEAN;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    -- Skip if already blocked
    SELECT EXISTS (
        SELECT 1 FROM public.ip_blacklist
        WHERE ip_address = p_ip
          AND (expires_at IS NULL OR expires_at > NOW())
    ) INTO v_already_blocked;
    
    IF v_already_blocked THEN
        RETURN FALSE;
    END IF;
    
    -- Count lockouts from this IP in last 15 minutes (using profiles table)
    SELECT COUNT(*) INTO v_lockout_count
    FROM public.profiles
    WHERE last_login_ip = p_ip
      AND locked_until IS NOT NULL
      AND locked_until > NOW() - INTERVAL '15 minutes';
    
    -- If 3 or more lockouts, auto-blacklist for 24 hours
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
$$;

-- 6. Admin function to manually add IP to blacklist
CREATE OR REPLACE FUNCTION public.admin_add_ip_blacklist(
    p_ip TEXT,
    p_reason TEXT DEFAULT '手动添加',
    p_hours INTEGER DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Permission denied';
    END IF;
    
    INSERT INTO public.ip_blacklist (ip_address, reason, expires_at, is_permanent, created_by)
    VALUES (
        p_ip,
        p_reason,
        CASE WHEN p_hours IS NULL THEN NULL ELSE NOW() + (p_hours || ' hours')::INTERVAL END,
        p_hours IS NULL,
        auth.uid()
    )
    ON CONFLICT DO NOTHING;
    
    RETURN TRUE;
END;
$$;

-- 7. Admin function to remove IP from blacklist
CREATE OR REPLACE FUNCTION public.admin_remove_ip_blacklist(p_ip TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Permission denied';
    END IF;
    
    DELETE FROM public.ip_blacklist WHERE ip_address = p_ip;
    
    RETURN TRUE;
END;
$$;

-- 8. Get all blocked IPs (for admin panel)
CREATE OR REPLACE FUNCTION public.admin_get_blocked_ips()
RETURNS TABLE (
    ip_address TEXT,
    reason TEXT,
    blocked_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    is_permanent BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Permission denied';
    END IF;

    RETURN QUERY
    SELECT 
        b.ip_address,
        b.reason,
        b.blocked_at,
        b.expires_at,
        b.is_permanent
    FROM public.ip_blacklist b
    WHERE b.expires_at IS NULL OR b.expires_at > NOW()
    ORDER BY b.blocked_at DESC;
END;
$$;

-- 9. Grant permissions
REVOKE ALL ON FUNCTION public.check_ip_blacklisted(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_ip_blacklisted(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_login_ip TO authenticated;
REVOKE ALL ON FUNCTION public.check_auto_blacklist_ip(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_auto_blacklist_ip(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_add_ip_blacklist TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_ip_blacklist TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_blocked_ips TO authenticated;
