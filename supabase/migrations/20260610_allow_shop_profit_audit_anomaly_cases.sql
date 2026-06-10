ALTER TABLE public.payment_anomaly_cases
    DROP CONSTRAINT IF EXISTS payment_anomaly_cases_target_type_check;

ALTER TABLE public.payment_anomaly_cases
    ADD CONSTRAINT payment_anomaly_cases_target_type_check
    CHECK (target_type IN ('order', 'event', 'session', 'shop_profit_audit'));
