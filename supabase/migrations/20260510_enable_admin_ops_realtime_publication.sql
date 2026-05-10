-- Enable Admin Studio ops realtime as an optional fast path.
-- If Realtime is unavailable or this migration has not been applied, the
-- dashboard continues to use its normal API reads, auto refresh, and manual refresh.

DO $$
DECLARE
    v_table_name TEXT;
BEGIN
    IF TO_REGCLASS('public.ops_alert_jobs') IS NOT NULL THEN
        ALTER TABLE public.ops_alert_jobs ENABLE ROW LEVEL SECURITY;
        GRANT SELECT ON TABLE public.ops_alert_jobs TO authenticated;

        DROP POLICY IF EXISTS "Admins can view ops alert jobs" ON public.ops_alert_jobs;
        CREATE POLICY "Admins can view ops alert jobs"
            ON public.ops_alert_jobs
            FOR SELECT TO authenticated
            USING (public.is_admin());
    END IF;

    IF TO_REGCLASS('public.ops_alert_cases') IS NOT NULL THEN
        ALTER TABLE public.ops_alert_cases ENABLE ROW LEVEL SECURITY;
        GRANT SELECT ON TABLE public.ops_alert_cases TO authenticated;

        DROP POLICY IF EXISTS "Admins view all ops alert cases" ON public.ops_alert_cases;
        CREATE POLICY "Admins view all ops alert cases"
            ON public.ops_alert_cases
            FOR SELECT TO authenticated
            USING (public.is_admin());
    END IF;

    FOREACH v_table_name IN ARRAY ARRAY[
        'ops_alert_jobs',
        'ops_alert_cases',
        'payment_orders',
        'shop_orders',
        'shop_products'
    ]
    LOOP
        IF TO_REGCLASS('public.' || v_table_name) IS NOT NULL THEN
            EXECUTE FORMAT('ALTER TABLE public.%I REPLICA IDENTITY FULL', v_table_name);

            IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
                AND NOT EXISTS (
                    SELECT 1
                    FROM pg_publication_tables
                    WHERE pubname = 'supabase_realtime'
                        AND schemaname = 'public'
                        AND tablename = v_table_name
                )
            THEN
                EXECUTE FORMAT('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table_name);
            END IF;
        END IF;
    END LOOP;
END $$;
