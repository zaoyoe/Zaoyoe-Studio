-- Allow percent coupons to express free checkout as 0% settlement.
-- The allow_zero_total flag still decides whether a zero final total may pass.

CREATE OR REPLACE FUNCTION public.fn_resolve_shop_percent_discount(
    p_subtotal NUMERIC,
    p_discount_value INT,
    p_allow_zero_total BOOLEAN DEFAULT false
)
RETURNS TABLE (
    discount_amount NUMERIC(12,2),
    final_total NUMERIC(12,2),
    has_effective_discount BOOLEAN
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_subtotal NUMERIC(12,2) := ROUND(GREATEST(0, COALESCE(p_subtotal, 0))::NUMERIC, 2);
    v_discount_value INT := GREATEST(0, COALESCE(p_discount_value, 0));
    v_discounted_total NUMERIC(12,2) := 0;
    v_discount_amount NUMERIC(12,2) := 0;
BEGIN
    IF v_subtotal = 0 THEN
        RETURN QUERY
        SELECT 0::NUMERIC(12,2), v_subtotal, false;
        RETURN;
    END IF;

    v_discounted_total := ROUND((v_subtotal * v_discount_value::NUMERIC) / 100, 2);
    v_discounted_total := GREATEST(0, LEAST(v_subtotal, v_discounted_total));
    v_discount_amount := ROUND(GREATEST(0, v_subtotal - v_discounted_total), 2);

    IF v_discount_amount = 0 THEN
        RETURN QUERY
        SELECT 0::NUMERIC(12,2), v_subtotal, false;
        RETURN;
    END IF;

    IF v_discounted_total = 0
        AND NOT COALESCE(p_allow_zero_total, false) THEN
        RETURN QUERY
        SELECT v_discount_amount, 0::NUMERIC(12,2), false;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT v_discount_amount, v_discounted_total, true;
END;
$$;

COMMENT ON FUNCTION public.fn_resolve_shop_percent_discount(NUMERIC, INT, BOOLEAN)
    IS 'Resolves percent-settlement coupons; discount_value 0 means 0% settlement/free checkout when allow_zero_total is enabled.';
