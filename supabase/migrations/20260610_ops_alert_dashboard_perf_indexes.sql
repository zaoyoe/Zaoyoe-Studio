CREATE INDEX IF NOT EXISTS idx_ops_alert_jobs_alert_type_created_at
    ON public.ops_alert_jobs(alert_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_alert_job_attempts_created_at
    ON public.ops_alert_job_attempts(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_alert_job_attempts_channel_created_at
    ON public.ops_alert_job_attempts(channel, created_at DESC);
