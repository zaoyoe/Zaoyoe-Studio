-- ============================================
-- ANALYTICS INFRASTRUCTURE
-- Phase 0: Indexes & Materialized Views
-- ============================================
-- NOTE: 
-- - profiles 表没有 created_at 列，用户创建时间在 auth.users 表中
-- - redemption_codes 表使用 used_at (不是 redeemed_at)

-- ============================================
-- 1. PERFORMANCE INDEXES
-- Optimize common analytical queries
-- ============================================

-- Login history for DAU/MAU and time analysis
CREATE INDEX IF NOT EXISTS idx_login_history_created_at 
ON public.user_login_history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_login_user_created 
ON public.user_login_history(user_id, created_at DESC);

-- Points ledger for revenue analysis
CREATE INDEX IF NOT EXISTS idx_ledger_created_at 
ON public.points_ledger(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_reason 
ON public.points_ledger(reason);

CREATE INDEX IF NOT EXISTS idx_ledger_user_created 
ON public.points_ledger(user_id, created_at DESC);

-- Redemption codes for batch analysis (use used_at, not redeemed_at)
CREATE INDEX IF NOT EXISTS idx_codes_used_at 
ON public.redemption_codes(used_at DESC) 
WHERE used_at IS NOT NULL;

-- Prompt comments for content analysis
CREATE INDEX IF NOT EXISTS idx_prompt_comments_created 
ON public.prompt_comments(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_prompt_comments_prompt 
ON public.prompt_comments(prompt_id);

-- Prompt unlocks for conversion analysis
CREATE INDEX IF NOT EXISTS idx_unlocks_unlocked_at 
ON public.prompt_unlocks(unlocked_at DESC);

CREATE INDEX IF NOT EXISTS idx_unlocks_prompt 
ON public.prompt_unlocks(prompt_id);

-- Guestbook for community analysis
CREATE INDEX IF NOT EXISTS idx_guestbook_messages_created 
ON public.guestbook_messages(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_guestbook_comments_created 
ON public.guestbook_comments(created_at DESC);

-- ============================================
-- 2. UTILITY FUNCTIONS
-- Common analytics helpers
-- ============================================

-- 2.1 Get local date from timestamp (handles timezone)
CREATE OR REPLACE FUNCTION get_local_date(ts TIMESTAMPTZ)
RETURNS DATE AS $$
BEGIN
    RETURN (ts AT TIME ZONE 'Asia/Shanghai')::date;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2.2 Safe division (avoid divide by zero)
CREATE OR REPLACE FUNCTION safe_divide(numerator NUMERIC, denominator NUMERIC)
RETURNS NUMERIC AS $$
BEGIN
    IF denominator = 0 OR denominator IS NULL THEN
        RETURN 0;
    END IF;
    RETURN numerator / denominator;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 2.3 Calculate growth rate
CREATE OR REPLACE FUNCTION calc_growth_rate(current_val NUMERIC, previous_val NUMERIC)
RETURNS NUMERIC AS $$
BEGIN
    IF previous_val = 0 OR previous_val IS NULL THEN
        RETURN NULL; -- 返回 NULL 表示无法计算
    END IF;
    RETURN ROUND((current_val - previous_val) / previous_val * 100, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- 3. MATERIALIZED VIEWS
-- Pre-computed statistics for fast loading
-- ============================================

-- Drop existing views for re-creation
DROP MATERIALIZED VIEW IF EXISTS mv_daily_content_stats CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_channel_performance CASCADE;

-- 3.1 Daily Content Statistics
CREATE MATERIALIZED VIEW mv_daily_content_stats AS
SELECT 
    date_trunc('day', created_at AT TIME ZONE 'Asia/Shanghai')::date AS stat_date,
    COUNT(*) FILTER (WHERE TRUE) AS total_comments,
    COUNT(DISTINCT user_id) AS unique_commenters
FROM public.prompt_comments
WHERE created_at >= NOW() - INTERVAL '90 days'
GROUP BY 1
ORDER BY 1 DESC;

CREATE UNIQUE INDEX idx_mv_daily_content_stats_date 
ON mv_daily_content_stats(stat_date);

-- 3.2 Channel Performance Summary (JOIN points_packages for points_amount)
CREATE MATERIALIZED VIEW mv_channel_performance AS
SELECT 
    b.channel,
    COUNT(DISTINCT b.id) AS batch_count,
    COUNT(c.id) AS total_codes,
    COUNT(c.id) FILTER (WHERE c.status = 'used') AS used_codes,
    COALESCE(SUM(pkg.points_amount) FILTER (WHERE c.status = 'used'), 0) AS total_points_redeemed,
    ROUND(
        COUNT(c.id) FILTER (WHERE c.status = 'used')::numeric / 
        NULLIF(COUNT(c.id), 0) * 100, 
        2
    ) AS redemption_rate
FROM public.redemption_batches b
LEFT JOIN public.redemption_codes c ON c.batch_id = b.id
LEFT JOIN public.points_packages pkg ON b.package_id = pkg.id
GROUP BY b.channel
ORDER BY total_points_redeemed DESC;

CREATE UNIQUE INDEX idx_mv_channel_performance_channel 
ON mv_channel_performance(channel);

-- ============================================
-- 4. REFRESH FUNCTION
-- Call this to update all materialized views
-- ============================================

CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_content_stats;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_channel_performance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5. GRANT PERMISSIONS
-- ============================================

-- Allow authenticated users to read materialized views
GRANT SELECT ON mv_daily_content_stats TO authenticated;
GRANT SELECT ON mv_channel_performance TO authenticated;

-- Allow admins to refresh views
GRANT EXECUTE ON FUNCTION refresh_analytics_views() TO authenticated;
GRANT EXECUTE ON FUNCTION get_local_date(TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION safe_divide(NUMERIC, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION calc_growth_rate(NUMERIC, NUMERIC) TO authenticated;

-- ============================================
-- DONE! Run this in Supabase SQL Editor
-- ============================================
