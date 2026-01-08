-- ============================================
-- USER TAGS SYSTEM
-- Admin-assignable labels for users
-- ============================================

-- 1. User Tags Table
CREATE TABLE IF NOT EXISTS public.user_tags (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    tag TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES public.profiles(id),
    UNIQUE(user_id, tag)
);

-- 2. Enable RLS
ALTER TABLE public.user_tags ENABLE ROW LEVEL SECURITY;

-- 3. Policies (drop first to avoid errors on re-run)
DROP POLICY IF EXISTS "Tags are viewable by everyone" ON public.user_tags;
CREATE POLICY "Tags are viewable by everyone"
ON public.user_tags FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Admins can insert tags" ON public.user_tags;
CREATE POLICY "Admins can insert tags"
ON public.user_tags FOR INSERT
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete tags" ON public.user_tags;
CREATE POLICY "Admins can delete tags"
ON public.user_tags FOR DELETE
USING (public.is_admin());

-- ============================================
-- ADMIN AUDIT LOG
-- Records all admin actions for accountability
-- ============================================

-- 1. Audit Log Table
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    admin_id UUID REFERENCES public.profiles(id) NOT NULL,
    action TEXT NOT NULL,
    target_user_id UUID REFERENCES public.profiles(id),
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Enable RLS
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- 3. Policies
DROP POLICY IF EXISTS "Admins can view audit log" ON public.admin_audit_log;
CREATE POLICY "Admins can view audit log"
ON public.admin_audit_log FOR SELECT
USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert audit entries" ON public.admin_audit_log;
CREATE POLICY "Admins can insert audit entries"
ON public.admin_audit_log FOR INSERT
WITH CHECK (public.is_admin());

-- ============================================
-- INDEX for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_user_tags_user_id ON public.user_tags(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON public.admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target_user ON public.admin_audit_log(target_user_id);

-- ============================================
-- USER LOGIN HISTORY (Multi-Account Detection)
-- Records login IP addresses for correlation analysis
-- ============================================

CREATE TABLE IF NOT EXISTS public.user_login_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    ip_address INET NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.user_login_history ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "Users can insert own login history" ON public.user_login_history;
CREATE POLICY "Users can insert own login history"
ON public.user_login_history FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view login history" ON public.user_login_history;
CREATE POLICY "Admins can view login history"
ON public.user_login_history FOR SELECT
USING (public.is_admin());

-- Index for fast IP lookups
CREATE INDEX IF NOT EXISTS idx_login_history_ip ON public.user_login_history(ip_address);
CREATE INDEX IF NOT EXISTS idx_login_history_user ON public.user_login_history(user_id);

-- ============================================
-- FUNCTION: Find Related Accounts by IP
-- Returns users who share any IP with the given user
-- ============================================

CREATE OR REPLACE FUNCTION public.find_related_accounts(target_user_id UUID)
RETURNS TABLE (
    related_user_id UUID,
    related_username TEXT,
    shared_ip INET,
    login_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT
        lh2.user_id AS related_user_id,
        p.username AS related_username,
        lh2.ip_address AS shared_ip,
        COUNT(*) OVER (PARTITION BY lh2.user_id) AS login_count
    FROM public.user_login_history lh1
    JOIN public.user_login_history lh2 ON lh1.ip_address = lh2.ip_address
    JOIN public.profiles p ON lh2.user_id = p.id
    WHERE lh1.user_id = target_user_id
      AND lh2.user_id != target_user_id
    ORDER BY login_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- BLOCK HISTORY (Permanent Record)
-- Records all block/unblock actions
-- ============================================

CREATE TABLE IF NOT EXISTS public.block_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('block', 'unblock')),
    scope TEXT DEFAULT 'all',
    reason TEXT,
    admin_id UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.block_history ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "Admins can view block history" ON public.block_history;
CREATE POLICY "Admins can view block history"
ON public.block_history FOR SELECT
USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert block history" ON public.block_history;
CREATE POLICY "Admins can insert block history"
ON public.block_history FOR INSERT
WITH CHECK (public.is_admin());

-- Index
CREATE INDEX IF NOT EXISTS idx_block_history_user ON public.block_history(user_id);
CREATE INDEX IF NOT EXISTS idx_block_history_created ON public.block_history(created_at DESC);
