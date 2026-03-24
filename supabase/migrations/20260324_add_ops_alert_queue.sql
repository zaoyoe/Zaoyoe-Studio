-- ============================================
-- 2026-03-24 External Ops Alert Queue
-- Queue + attempts log for Telegram / Feishu refund ops alerts
-- ============================================

CREATE TABLE IF NOT EXISTS public.ops_alert_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning',
    dedupe_key TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    channels JSONB NOT NULL DEFAULT '[]'::jsonb,
    remaining_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 6,
    next_retry_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    last_error TEXT,
    source TEXT,
    created_by UUID REFERENCES auth.users(id),
    worker_name TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_alert_jobs_due
    ON public.ops_alert_jobs(status, next_retry_at, created_at)
    WHERE status IN ('pending', 'retry');

CREATE INDEX IF NOT EXISTS idx_ops_alert_jobs_dedupe
    ON public.ops_alert_jobs(dedupe_key, created_at DESC);

ALTER TABLE public.ops_alert_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view ops alert jobs" ON public.ops_alert_jobs;
CREATE POLICY "Admins can view ops alert jobs"
    ON public.ops_alert_jobs FOR SELECT
    TO authenticated
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can manage ops alert jobs" ON public.ops_alert_jobs;
CREATE POLICY "Admins can manage ops alert jobs"
    ON public.ops_alert_jobs FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE TABLE IF NOT EXISTS public.ops_alert_job_attempts (
    id BIGSERIAL PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES public.ops_alert_jobs(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'failed',
    response_status INTEGER,
    response_body TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ops_alert_job_attempts_job_id
    ON public.ops_alert_job_attempts(job_id, created_at DESC);

ALTER TABLE public.ops_alert_job_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view ops alert attempts" ON public.ops_alert_job_attempts;
CREATE POLICY "Admins can view ops alert attempts"
    ON public.ops_alert_job_attempts FOR SELECT
    TO authenticated
    USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can manage ops alert attempts" ON public.ops_alert_job_attempts;
CREATE POLICY "Admins can manage ops alert attempts"
    ON public.ops_alert_job_attempts FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

INSERT INTO public.system_config (
    config_key,
    config_value,
    description,
    updated_at
)
VALUES (
    'ops_alerts',
    jsonb_build_object(
        'enabled', false,
        'dedupe_window_minutes', 45,
        'batch_size', 10,
        'sweep_interval_ms', 15000,
        'max_attempts', 6,
        'retry_base_delay_ms', 60000,
        'retry_max_delay_ms', 1800000,
        'timeout_ms', 5000,
        'channels', jsonb_build_object(
            'telegram', jsonb_build_object(
                'enabled', false,
                'minimum_severity', 'warning',
                'chat_ids', '[]'::jsonb
            ),
            'feishu', jsonb_build_object(
                'enabled', false,
                'minimum_severity', 'warning'
            )
        )
    ),
    '站外运维告警配置',
    NOW()
)
ON CONFLICT (config_key) DO UPDATE
SET
    description = EXCLUDED.description,
    updated_at = NOW(),
    config_value = CASE
        WHEN public.system_config.config_value IS NULL OR public.system_config.config_value = '{}'::jsonb THEN EXCLUDED.config_value
        ELSE public.system_config.config_value
    END;

COMMENT ON TABLE public.ops_alert_jobs IS 'Asynchronous outbound ops alerts for high-risk payment/refund incidents';
COMMENT ON TABLE public.ops_alert_job_attempts IS 'Per-channel delivery attempts for outbound ops alerts';
