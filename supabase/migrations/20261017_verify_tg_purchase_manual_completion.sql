-- Read-only structural verification. Does not complete or modify any order.
BEGIN TRANSACTION READ ONLY;
DO $$
BEGIN
    IF to_regprocedure('public.fn_tg_purchase_completion_ready()') IS NULL THEN
        RAISE EXCEPTION 'TG manual completion migration is not installed';
    END IF;
    IF NOT public.fn_tg_purchase_completion_ready() THEN
        RAISE EXCEPTION 'TG manual completion structural checks failed';
    END IF;
END;
$$;
SELECT 'TG manual completion structural checks passed; concurrent/business acceptance remains NOT RUN' AS result;
COMMIT;
