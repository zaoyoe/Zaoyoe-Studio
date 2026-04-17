ALTER TABLE public.discount_event_logs
    DROP CONSTRAINT IF EXISTS discount_event_logs_event_type_check;

ALTER TABLE public.discount_event_logs
    ADD CONSTRAINT discount_event_logs_event_type_check
    CHECK (event_type IN ('discover', 'claim', 'apply_attempt', 'redeem', 'refund_restore', 'wallet_remove'));
