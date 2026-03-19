-- ============================================
-- 2026-03-19 Admin Security Hardening
-- 1. Remove hardcoded admin email allowlists
-- 2. Harden chat session ownership
-- 3. Add audit logging for config changes
-- 4. Replace placeholder analytics with real calculations
-- ============================================

-- --------------------------------------------
-- Core Admin Role Model
-- --------------------------------------------

CREATE TABLE IF NOT EXISTS public.admin_roles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE NOT NULL,
    role_name TEXT NOT NULL DEFAULT 'admin',
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    granted_by UUID REFERENCES public.profiles(id),
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_roles_user_id ON public.admin_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_roles_expires_at ON public.admin_roles(expires_at);

ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;

INSERT INTO public.admin_roles (user_id, role_name, permissions, notes)
SELECT
    au.id,
    'super_admin',
    jsonb_build_array('*'),
    'Backfilled from legacy hardcoded allowlist on 2026-03-19'
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

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.admin_roles
        WHERE user_id = auth.uid()
          AND (expires_at IS NULL OR expires_at > NOW())
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.has_permission(p_permission TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF public.is_super_admin() THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.admin_roles
        WHERE user_id = auth.uid()
          AND (expires_at IS NULL OR expires_at > NOW())
          AND (
              COALESCE(permissions, '[]'::jsonb) @> jsonb_build_array(p_permission)
              OR COALESCE(permissions, '[]'::jsonb) @> jsonb_build_array('*')
          )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_user_permissions(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_role RECORD;
BEGIN
    SELECT
        role_name,
        COALESCE(permissions, '[]'::jsonb) AS permissions,
        expires_at
    INTO v_role
    FROM public.admin_roles
    WHERE user_id = p_user_id
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.require_admin_access()
RETURNS VOID AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_permissions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.require_admin_access() TO authenticated;

DROP POLICY IF EXISTS "Super admin can view roles" ON public.admin_roles;
CREATE POLICY "Super admin can view roles"
ON public.admin_roles FOR SELECT
USING (public.is_admin());

DROP POLICY IF EXISTS "Super admin can manage roles" ON public.admin_roles;
CREATE POLICY "Super admin can manage roles"
ON public.admin_roles FOR ALL
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

-- --------------------------------------------
-- Admin Extensions / Audit Visibility
-- --------------------------------------------

DROP POLICY IF EXISTS "Admins can view all notes" ON public.admin_notes;
CREATE POLICY "Admins can view all notes"
  ON public.admin_notes FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert notes" ON public.admin_notes;
CREATE POLICY "Admins can insert notes"
  ON public.admin_notes FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete notes" ON public.admin_notes;
CREATE POLICY "Admins can delete notes"
  ON public.admin_notes FOR DELETE
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can view audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admins can view audit logs"
  ON public.admin_audit_logs FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admins can insert audit logs"
  ON public.admin_audit_logs FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admins can delete audit logs"
  ON public.admin_audit_logs FOR DELETE
  USING (public.is_super_admin());

DROP POLICY IF EXISTS "Admins can send notifications" ON public.system_notifications;
CREATE POLICY "Admins can send notifications"
  ON public.system_notifications FOR INSERT
  WITH CHECK (public.is_admin());

DROP FUNCTION IF EXISTS public.get_admin_users();

CREATE OR REPLACE FUNCTION public.get_admin_users()
RETURNS TABLE (
  id uuid,
  email varchar,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  username text,
  avatar_url text
)
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    au.id,
    au.email::varchar,
    au.created_at,
    au.last_sign_in_at,
    p.username,
    p.avatar_url
  FROM auth.users au
  LEFT JOIN public.profiles p ON au.id = p.id
  ORDER BY au.created_at DESC;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.get_admin_users() TO authenticated;

-- --------------------------------------------
-- System Config / Homepage / IP Blacklist
-- --------------------------------------------

DROP POLICY IF EXISTS "Admins can manage config" ON public.system_config;
CREATE POLICY "Admins can manage config" ON public.system_config
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.update_system_config(
    p_key TEXT,
    p_value JSONB
)
RETURNS BOOLEAN AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Permission denied';
    END IF;

    INSERT INTO public.system_config (config_key, config_value, updated_by, updated_at)
    VALUES (p_key, p_value, auth.uid(), NOW())
    ON CONFLICT (config_key) DO UPDATE SET
        config_value = EXCLUDED.config_value,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at;

    BEGIN
        INSERT INTO public.admin_audit_logs (admin_id, action_type, details)
        VALUES (
            auth.uid(),
            'system_config.update',
            jsonb_build_object('config_key', p_key, 'config_value', p_value)
        );
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP POLICY IF EXISTS "Admins manage homepage config" ON public.homepage_config;
CREATE POLICY "Admins manage homepage config"
    ON public.homepage_config FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.audit_homepage_config_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND public.is_admin() THEN
        BEGIN
            INSERT INTO public.admin_audit_logs (admin_id, action_type, details)
            VALUES (
                auth.uid(),
                CASE TG_OP
                    WHEN 'INSERT' THEN 'homepage_config.create'
                    WHEN 'DELETE' THEN 'homepage_config.delete'
                    ELSE 'homepage_config.update'
                END,
                jsonb_build_object(
                    'section', COALESCE(NEW.section, OLD.section),
                    'operation', TG_OP,
                    'old', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
                    'new', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
                )
            );
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_audit_homepage_config_changes ON public.homepage_config;
CREATE TRIGGER trg_audit_homepage_config_changes
AFTER INSERT OR UPDATE OR DELETE ON public.homepage_config
FOR EACH ROW
EXECUTE FUNCTION public.audit_homepage_config_changes();

DROP POLICY IF EXISTS "Admins can manage ip_blacklist" ON public.ip_blacklist;
CREATE POLICY "Admins can manage ip_blacklist" ON public.ip_blacklist
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

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

DROP FUNCTION IF EXISTS public.admin_get_blocked_ips();

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

-- --------------------------------------------
-- Login Security (super admin only)
-- --------------------------------------------

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

-- --------------------------------------------
-- Shop / Ticket Policies
-- --------------------------------------------

DROP POLICY IF EXISTS "Admins manage inventory" ON public.shop_inventory;
CREATE POLICY "Admins manage inventory" ON public.shop_inventory FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "Admins view all orders" ON public.shop_orders;
CREATE POLICY "Admins view all orders" ON public.shop_orders FOR SELECT USING (public.is_admin());

DROP FUNCTION IF EXISTS public.fn_admin_lookup_order(UUID);

CREATE OR REPLACE FUNCTION public.fn_admin_lookup_order(p_order_id UUID DEFAULT NULL)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    product_id UUID,
    inventory_id UUID,
    price_paid INT,
    snapshot_product_name VARCHAR,
    refund_status VARCHAR,
    created_at TIMESTAMPTZ,
    inventory_content TEXT,
    inventory_status VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied: Admin only';
    END IF;

    RETURN QUERY
    SELECT
        o.id,
        o.user_id,
        o.product_id,
        o.inventory_id,
        o.price_paid,
        o.snapshot_product_name,
        o.refund_status,
        o.created_at,
        i.content AS inventory_content,
        i.status AS inventory_status
    FROM shop_orders o
    LEFT JOIN shop_inventory i ON o.inventory_id = i.id
    WHERE (p_order_id IS NULL OR o.id = p_order_id)
    ORDER BY o.created_at DESC
    LIMIT 50;
END;
$$;

DROP POLICY IF EXISTS "Admins can view all tickets" ON public.shop_tickets;
CREATE POLICY "Admins can view all tickets"
ON public.shop_tickets FOR SELECT
USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update tickets" ON public.shop_tickets;
CREATE POLICY "Admins can update tickets"
ON public.shop_tickets FOR UPDATE
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete tickets" ON public.shop_tickets;
CREATE POLICY "Admins can delete tickets"
ON public.shop_tickets FOR DELETE
USING (public.is_super_admin());

DROP POLICY IF EXISTS "Admins view all order items" ON public.shop_order_items;
CREATE POLICY "Admins view all order items" ON public.shop_order_items FOR SELECT USING (public.is_admin());

-- --------------------------------------------
-- Chat Session Ownership Hardening
-- --------------------------------------------

CREATE OR REPLACE FUNCTION public.current_chat_session_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(((current_setting('request.headers', true))::jsonb ->> 'x-session-id'), '');
$$;

CREATE OR REPLACE FUNCTION public.authenticated_chat_session_id(p_user_id uuid DEFAULT auth.uid())
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN NULL
    ELSE 'user_' || p_user_id::text
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_chat_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF auth.role() <> 'authenticated' THEN
    RETURN FALSE;
  END IF;

  RETURN public.is_admin();
END;
$$;

GRANT EXECUTE ON FUNCTION public.current_chat_session_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authenticated_chat_session_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_chat_admin() TO anon, authenticated;

DROP POLICY IF EXISTS "Public read access" ON public.chat_messages;
DROP POLICY IF EXISTS "Read own session messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Public insert access" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can read their own chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can insert their own chat messages" ON public.chat_messages;

CREATE POLICY "Users can read their own chat messages"
ON public.chat_messages FOR SELECT
USING (
    public.is_chat_admin()
    OR (user_id IS NOT NULL AND auth.uid() = user_id)
    OR (
        auth.uid() IS NOT NULL
        AND session_id = public.authenticated_chat_session_id()
    )
    OR (
        COALESCE(auth.jwt() ->> 'email', '') <> ''
        AND lower(COALESCE(session_id, '')) = lower(auth.jwt() ->> 'email')
    )
    OR (
        auth.uid() IS NULL
        AND public.current_chat_session_id() IS NOT NULL
        AND session_id = public.current_chat_session_id()
    )
);

CREATE POLICY "Users can insert their own chat messages"
ON public.chat_messages FOR INSERT
WITH CHECK (
    (
        public.is_chat_admin()
        AND is_admin = TRUE
    )
    OR (
        is_admin = FALSE
        AND auth.uid() IS NOT NULL
        AND user_id = auth.uid()
        AND session_id = public.authenticated_chat_session_id()
    )
    OR (
        is_admin = FALSE
        AND auth.uid() IS NULL
        AND user_id IS NULL
        AND public.current_chat_session_id() IS NOT NULL
        AND session_id = public.current_chat_session_id()
    )
);

-- --------------------------------------------
-- Analytics: real geo + real A/B results
-- --------------------------------------------

DROP POLICY IF EXISTS "Admins can read all events" ON public.user_events;
CREATE POLICY "Admins can read all events" ON public.user_events
    FOR SELECT TO authenticated
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can manage experiments" ON public.ab_experiments;
CREATE POLICY "Admins can manage experiments" ON public.ab_experiments
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can manage assignments" ON public.ab_assignments;
CREATE POLICY "Admins can manage assignments" ON public.ab_assignments
    FOR ALL TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.get_geo_distribution_by_site(p_site VARCHAR DEFAULT NULL)
RETURNS TABLE (
    region TEXT,
    user_count BIGINT,
    percentage NUMERIC
) AS $$
DECLARE
    v_total BIGINT;
BEGIN
    PERFORM public.require_admin_access();

    SELECT COUNT(DISTINCT user_id) INTO v_total
    FROM public.user_login_history
    WHERE geo_info IS NOT NULL
      AND (p_site IS NULL OR site = p_site);

    IF v_total = 0 THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        COALESCE(NULLIF(geo_info->>'region', ''), geo_info->>'country', '未知地区')::TEXT AS region,
        COUNT(DISTINCT user_id)::BIGINT AS user_count,
        ROUND(COUNT(DISTINCT user_id)::NUMERIC / NULLIF(v_total, 0) * 100, 1) AS percentage
    FROM public.user_login_history
    WHERE geo_info IS NOT NULL
      AND (p_site IS NULL OR site = p_site)
    GROUP BY COALESCE(NULLIF(geo_info->>'region', ''), geo_info->>'country', '未知地区')
    ORDER BY user_count DESC
    LIMIT 10;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS public.get_geo_distribution();

CREATE OR REPLACE FUNCTION public.get_geo_distribution()
RETURNS TABLE (
    region TEXT,
    user_count BIGINT,
    percentage NUMERIC
) AS $$
BEGIN
    RETURN QUERY SELECT * FROM public.get_geo_distribution_by_site(NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS public.get_experiment_results(UUID);

CREATE OR REPLACE FUNCTION public.get_experiment_results(p_experiment_id UUID)
RETURNS TABLE (
    variant_name TEXT,
    user_count BIGINT,
    conversion_count BIGINT,
    conversion_rate NUMERIC
) AS $$
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    WITH experiment AS (
        SELECT id, target_metric
        FROM public.ab_experiments
        WHERE id = p_experiment_id
    ),
    assignment_base AS (
        SELECT a.user_id, a.variant_name, a.assigned_at
        FROM public.ab_assignments a
        WHERE a.experiment_id = p_experiment_id
    ),
    conversions AS (
        SELECT DISTINCT
            a.variant_name,
            a.user_id
        FROM assignment_base a
        CROSS JOIN experiment e
        JOIN public.user_events ue
          ON ue.user_id = a.user_id
         AND ue.created_at >= a.assigned_at
         AND (
            (COALESCE(e.target_metric, '') <> '' AND ue.event_name = e.target_metric)
            OR (
                COALESCE(e.target_metric, '') = ''
                AND ue.event_type = 'conversion'
            )
            OR COALESCE(ue.event_data->>'experiment_id', '') = p_experiment_id::TEXT
         )
    )
    SELECT
        a.variant_name::TEXT,
        COUNT(DISTINCT a.user_id)::BIGINT AS user_count,
        COUNT(DISTINCT c.user_id)::BIGINT AS conversion_count,
        ROUND(
            COUNT(DISTINCT c.user_id)::NUMERIC
            / NULLIF(COUNT(DISTINCT a.user_id), 0) * 100,
            1
        ) AS conversion_rate
    FROM assignment_base a
    LEFT JOIN conversions c
      ON c.variant_name = a.variant_name
     AND c.user_id = a.user_id
    GROUP BY a.variant_name
    ORDER BY a.variant_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_geo_distribution_by_site(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_geo_distribution() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_experiment_results(UUID) TO authenticated;
