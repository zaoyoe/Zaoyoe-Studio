-- Read-only structure and privilege check; not a business/concurrency acceptance test.
BEGIN TRANSACTION READ ONLY;
DO $$
BEGIN
    IF to_regprocedure('public.fn_tg_redemption_resolution_ready()') IS NULL THEN
        RAISE EXCEPTION 'TG redemption resolution migration is not installed';
    END IF;
    IF NOT public.fn_tg_redemption_resolution_ready() THEN
        RAISE EXCEPTION 'TG redemption resolution structural checks failed';
    END IF;
    IF to_regprocedure('public.fn_tg_redemption_resolution_confirmation_ready()') IS NULL THEN
        RAISE EXCEPTION 'TG redemption resolution confirmation repair is not installed';
    END IF;
    IF NOT public.fn_tg_redemption_resolution_confirmation_ready() THEN
        RAISE EXCEPTION 'TG redemption resolution confirmation checks failed';
    END IF;
    IF has_function_privilege('anon', 'public.fn_tg_redemption_resolution_confirmation_ready()', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_tg_redemption_resolution_confirmation_ready()', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.fn_tg_redemption_resolution_confirmation_ready()', 'EXECUTE') THEN
        RAISE EXCEPTION 'TG redemption resolution confirmation privilege checks failed';
    END IF;
    IF has_function_privilege('anon', 'public.fn_tg_apply_redemption_resolution(text,uuid,text,uuid,text,timestamptz,timestamptz,text,text,text,text,text,jsonb,timestamptz,jsonb)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.fn_tg_apply_redemption_resolution(text,uuid,text,uuid,text,timestamptz,timestamptz,text,text,text,text,text,jsonb,timestamptz,jsonb)', 'EXECUTE')
       OR has_table_privilege('service_role', 'public.tg_redemption_resolution_events', 'INSERT,UPDATE,DELETE') THEN
        RAISE EXCEPTION 'TG redemption resolution privilege checks failed';
    END IF;
END;
$$;
SELECT 'TG redemption resolution structural checks passed; concurrent/business acceptance remains NOT RUN' AS result;
COMMIT;
