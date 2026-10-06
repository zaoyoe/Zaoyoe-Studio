-- Verification for 20261004_guest_shop_cancel_review_order.sql
DO $$
DECLARE
    v_def text;
BEGIN
    SELECT pg_get_functiondef('public.fn_guest_shop_cancel_order(uuid,text)'::regprocedure)
    INTO v_def;

    IF v_def IS NULL OR v_def NOT LIKE '%v_order.payment_status NOT IN (''pending'', ''review'')%' THEN
        RAISE EXCEPTION 'Verification failed: fn_guest_shop_cancel_order does not allow review payment_status';
    END IF;

    SELECT pg_get_functiondef('public.fn_guest_shop_cancel_checkout_batch(uuid,text)'::regprocedure)
    INTO v_def;

    IF v_def IS NULL OR v_def NOT LIKE '%v_batch.payment_status NOT IN (''pending'', ''review'')%' THEN
        RAISE EXCEPTION 'Verification failed: fn_guest_shop_cancel_checkout_batch does not allow review payment_status';
    END IF;

    RAISE NOTICE 'Verification passed: fn_guest_shop_cancel_order and batch cancellation support review state.';
END $$;
