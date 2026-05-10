-- Enable storefront catalog realtime as an optional fast path.
-- The frontend never blocks on these channels; if Realtime or this publication
-- entry is unavailable, normal catalog API reads and purchase-time refreshes
-- continue to work.

DO $$
DECLARE
    v_table_name TEXT;
BEGIN
    FOREACH v_table_name IN ARRAY ARRAY[
        'shop_products',
        'shop_categories'
    ]
    LOOP
        IF TO_REGCLASS('public.' || v_table_name) IS NOT NULL THEN
            EXECUTE FORMAT('GRANT SELECT ON TABLE public.%I TO anon, authenticated', v_table_name);

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
