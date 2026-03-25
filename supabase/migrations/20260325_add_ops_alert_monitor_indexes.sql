-- ============================================
-- 2026-03-25 Ops alert monitor performance indexes
-- Speeds up admin ops alert health / monitor dashboards
-- ============================================

CREATE INDEX IF NOT EXISTS idx_ops_alert_jobs_created_at_desc
    ON public.ops_alert_jobs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_alert_jobs_alert_type_created_at_desc
    ON public.ops_alert_jobs(alert_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_alert_job_attempts_created_at_desc
    ON public.ops_alert_job_attempts(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_alert_job_attempts_channel_created_at_desc
    ON public.ops_alert_job_attempts(channel, created_at DESC);
