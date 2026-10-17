-- Read-only structural verification; does not complete or modify any order.
BEGIN TRANSACTION READ ONLY;
DO $$
BEGIN
    IF to_regprocedure('public.fn_tg_purchase_payment_review_completion_ready()') IS NULL THEN
        RAISE EXCEPTION 'TG payment-review completion migration is not installed';
    END IF;
    IF NOT public.fn_tg_purchase_payment_review_completion_ready() THEN
        RAISE EXCEPTION 'TG payment-review completion structural checks failed';
    END IF;
    IF has_function_privilege('anon', 'public.fn_tg_purchase_payment_review_completion_ready()', 'EXECUTE')
        OR has_function_privilege('authenticated', 'public.fn_tg_purchase_payment_review_completion_ready()', 'EXECUTE')
        OR NOT has_function_privilege('service_role', 'public.fn_tg_purchase_payment_review_completion_ready()', 'EXECUTE') THEN
        RAISE EXCEPTION 'TG payment-review capability permissions are invalid';
    END IF;
END;
$$;
SELECT 'TG payment-review completion structural checks passed; concurrent/business acceptance remains NOT RUN' AS result;
COMMIT;
