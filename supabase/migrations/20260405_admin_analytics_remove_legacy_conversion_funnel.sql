-- Retire the legacy proxy conversion funnel RPC now that admin
-- analytics only consumes the real-event conversion funnel v2.

DO $$
BEGIN
    IF to_regprocedure('public.get_conversion_funnel(integer, character varying, date, date)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.get_conversion_funnel(INTEGER, VARCHAR, DATE, DATE) FROM PUBLIC;
        REVOKE ALL ON FUNCTION public.get_conversion_funnel(INTEGER, VARCHAR, DATE, DATE) FROM authenticated;
        REVOKE ALL ON FUNCTION public.get_conversion_funnel(INTEGER, VARCHAR, DATE, DATE) FROM service_role;
    END IF;
END $$;

DROP FUNCTION IF EXISTS public.get_conversion_funnel(INTEGER, VARCHAR, DATE, DATE);

DO $$
BEGIN
    IF to_regprocedure('public.get_conversion_funnel(integer, character varying)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.get_conversion_funnel(INTEGER, VARCHAR) FROM PUBLIC;
        REVOKE ALL ON FUNCTION public.get_conversion_funnel(INTEGER, VARCHAR) FROM authenticated;
        REVOKE ALL ON FUNCTION public.get_conversion_funnel(INTEGER, VARCHAR) FROM service_role;
    END IF;
END $$;

DROP FUNCTION IF EXISTS public.get_conversion_funnel(INTEGER, VARCHAR);

DO $$
BEGIN
    IF to_regprocedure('public.get_conversion_funnel(integer)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.get_conversion_funnel(INTEGER) FROM PUBLIC;
        REVOKE ALL ON FUNCTION public.get_conversion_funnel(INTEGER) FROM authenticated;
        REVOKE ALL ON FUNCTION public.get_conversion_funnel(INTEGER) FROM service_role;
    END IF;
END $$;

DROP FUNCTION IF EXISTS public.get_conversion_funnel(INTEGER);
