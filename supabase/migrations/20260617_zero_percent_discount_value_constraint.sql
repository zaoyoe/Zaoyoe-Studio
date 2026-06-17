-- Relax the legacy discount value check so percent coupons can express free checkout.

ALTER TABLE public.discount_codes
    DROP CONSTRAINT IF EXISTS chk_discount_value_percent;

ALTER TABLE public.discount_codes
    ADD CONSTRAINT chk_discount_value_percent
    CHECK (
        (discount_type = 'percent' AND discount_value >= 0 AND discount_value <= 100)
        OR (discount_type = 'fixed' AND discount_value > 0)
    );
