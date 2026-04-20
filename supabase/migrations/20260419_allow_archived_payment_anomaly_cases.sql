ALTER TABLE public.payment_anomaly_cases
    DROP CONSTRAINT IF EXISTS payment_anomaly_cases_status_check;

ALTER TABLE public.payment_anomaly_cases
    ADD CONSTRAINT payment_anomaly_cases_status_check
    CHECK (status IN ('open', 'handled', 'ignored', 'retry_requested', 'approved', 'rejected', 'archived'));
