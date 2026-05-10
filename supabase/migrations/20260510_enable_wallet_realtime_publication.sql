-- Enable wallet/order realtime as an optional fast path.
-- The frontend treats these channels as non-blocking; if Realtime is unavailable,
-- existing API reads and cached snapshots continue to work.

DO $$
DECLARE
    v_table_name TEXT;
BEGIN
    IF TO_REGCLASS('public.points_balance') IS NOT NULL THEN
        ALTER TABLE public.points_balance ENABLE ROW LEVEL SECURITY;
        GRANT SELECT ON TABLE public.points_balance TO authenticated;

        DROP POLICY IF EXISTS "Users view own points balance" ON public.points_balance;
        CREATE POLICY "Users view own points balance"
            ON public.points_balance
            FOR SELECT TO authenticated
            USING (auth.uid() = user_id OR public.is_admin());
    END IF;

    IF TO_REGCLASS('public.points_ledger') IS NOT NULL THEN
        ALTER TABLE public.points_ledger ENABLE ROW LEVEL SECURITY;
        GRANT SELECT ON TABLE public.points_ledger TO authenticated;

        DROP POLICY IF EXISTS "Users view own points ledger" ON public.points_ledger;
        CREATE POLICY "Users view own points ledger"
            ON public.points_ledger
            FOR SELECT TO authenticated
            USING (auth.uid() = user_id OR public.is_admin());
    END IF;

    IF TO_REGCLASS('public.shop_orders') IS NOT NULL THEN
        ALTER TABLE public.shop_orders ENABLE ROW LEVEL SECURITY;
        GRANT SELECT ON TABLE public.shop_orders TO authenticated;

        DROP POLICY IF EXISTS "Users view own shop orders" ON public.shop_orders;
        CREATE POLICY "Users view own shop orders"
            ON public.shop_orders
            FOR SELECT TO authenticated
            USING (auth.uid() = user_id OR public.is_admin());
    END IF;

    IF TO_REGCLASS('public.payment_orders') IS NOT NULL THEN
        ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
        GRANT SELECT ON TABLE public.payment_orders TO authenticated;

        DROP POLICY IF EXISTS "Users view own payment orders" ON public.payment_orders;
        CREATE POLICY "Users view own payment orders"
            ON public.payment_orders
            FOR SELECT TO authenticated
            USING (auth.uid() = user_id OR public.is_admin());
    END IF;

    FOREACH v_table_name IN ARRAY ARRAY[
        'points_balance',
        'points_ledger',
        'shop_orders',
        'payment_orders'
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
