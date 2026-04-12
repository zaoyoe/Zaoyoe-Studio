-- Indexes for Admin Payments summary read paths.
-- These target the overview/ops queries that scan by created_at, site, and
-- anomaly target linkage.

CREATE INDEX IF NOT EXISTS idx_payment_orders_created_at
    ON public.payment_orders(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_orders_site_created_at
    ON public.payment_orders(site, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_events_created_at
    ON public.payment_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_events_order_created_at
    ON public.payment_events(payment_order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_events_provider_order_created_at
    ON public.payment_events(provider_order_no, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_query_attempts_created_at
    ON public.payment_query_attempts(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_checkout_sessions_created_at
    ON public.payment_checkout_sessions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_checkout_sessions_site_created_at
    ON public.payment_checkout_sessions(site, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_alert_jobs_created_at
    ON public.ops_alert_jobs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_anomaly_cases_target_updated_at
    ON public.payment_anomaly_cases(target_type, target_id, updated_at DESC);
