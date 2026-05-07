-- Ensure customer engagement robot realtime subscriptions have database support.
-- Broadcast channels do not need a publication entry, but postgres_changes does.

DO $$
BEGIN
    CREATE TABLE IF NOT EXISTS public.engagement_feed_invalidations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reason TEXT NOT NULL DEFAULT 'engagement_config_changed',
        site VARCHAR(10) NOT NULL DEFAULT 'all',
        page_ids TEXT[] NOT NULL DEFAULT ARRAY['all']::TEXT[],
        source_table TEXT NOT NULL DEFAULT 'engagement_rules',
        source_id UUID,
        trigger_type TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_engagement_feed_invalidations_created_at
        ON public.engagement_feed_invalidations (created_at DESC);

    ALTER TABLE public.engagement_feed_invalidations ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Anyone can view engagement feed invalidations" ON public.engagement_feed_invalidations;
    CREATE POLICY "Anyone can view engagement feed invalidations"
        ON public.engagement_feed_invalidations FOR SELECT
        USING (TRUE);

    DROP POLICY IF EXISTS "Admins can create engagement feed invalidations" ON public.engagement_feed_invalidations;
    CREATE POLICY "Admins can create engagement feed invalidations"
        ON public.engagement_feed_invalidations FOR INSERT
        WITH CHECK (public.is_admin());

    IF TO_REGCLASS('public.engagement_deliveries') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.engagement_deliveries
            ADD COLUMN IF NOT EXISTS delivery_key TEXT NOT NULL DEFAULT '''',
            ADD COLUMN IF NOT EXISTS source_module TEXT NOT NULL DEFAULT ''engagement'',
            ADD COLUMN IF NOT EXISTS source_event_id TEXT NOT NULL DEFAULT ''''';

        EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_deliveries_user_delivery_key
            ON public.engagement_deliveries (user_id, delivery_key)
            WHERE user_id IS NOT NULL AND delivery_key <> ''''';

        ALTER TABLE public.engagement_deliveries ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS "Users can view own engagement deliveries" ON public.engagement_deliveries;
        CREATE POLICY "Users can view own engagement deliveries"
            ON public.engagement_deliveries FOR SELECT
            USING (auth.uid() = user_id);
    END IF;

    CREATE OR REPLACE FUNCTION public.fn_record_engagement_rule_invalidation()
    RETURNS TRIGGER AS $fn$
    DECLARE
        v_payload JSONB;
        v_page_ids TEXT[];
    BEGIN
        v_payload := CASE
            WHEN TG_OP = 'DELETE' THEN TO_JSONB(OLD)
            ELSE TO_JSONB(NEW)
        END;

        SELECT ARRAY_AGG(DISTINCT LOWER(BTRIM(value)))
        INTO v_page_ids
        FROM JSONB_ARRAY_ELEMENTS_TEXT(COALESCE(v_payload->'page_ids', '["all"]'::JSONB)) AS value
        WHERE BTRIM(value) <> '';

        IF v_page_ids IS NULL OR ARRAY_LENGTH(v_page_ids, 1) IS NULL THEN
            v_page_ids := ARRAY['all']::TEXT[];
        END IF;

        INSERT INTO public.engagement_feed_invalidations (
            reason,
            site,
            page_ids,
            source_table,
            source_id,
            trigger_type,
            metadata
        )
        VALUES (
            CASE WHEN TG_OP = 'DELETE' THEN 'rule_deleted' ELSE 'rule_changed' END,
            COALESCE(NULLIF(LOWER(BTRIM(v_payload->>'site')), ''), 'all'),
            v_page_ids,
            TG_TABLE_NAME,
            NULLIF(v_payload->>'id', '')::UUID,
            NULLIF(LOWER(BTRIM(v_payload->>'trigger_type')), ''),
            JSONB_BUILD_OBJECT('operation', TG_OP)
        );

        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

    IF TO_REGCLASS('public.engagement_rules') IS NOT NULL THEN
        DROP TRIGGER IF EXISTS trigger_engagement_rules_feed_invalidation ON public.engagement_rules;
        CREATE TRIGGER trigger_engagement_rules_feed_invalidation
            AFTER INSERT OR UPDATE OR DELETE ON public.engagement_rules
            FOR EACH ROW
            EXECUTE FUNCTION public.fn_record_engagement_rule_invalidation();
    END IF;

    IF TO_REGCLASS('public.engagement_feed_invalidations') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.engagement_feed_invalidations REPLICA IDENTITY FULL';
        IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
            AND NOT EXISTS (
                SELECT 1
                FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime'
                    AND schemaname = 'public'
                    AND tablename = 'engagement_feed_invalidations'
            )
        THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.engagement_feed_invalidations;
        END IF;
    END IF;

    IF TO_REGCLASS('public.system_notifications') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.system_notifications REPLICA IDENTITY FULL';
        IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
            AND NOT EXISTS (
                SELECT 1
                FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime'
                    AND schemaname = 'public'
                    AND tablename = 'system_notifications'
            )
        THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.system_notifications;
        END IF;
    END IF;

    IF TO_REGCLASS('public.engagement_deliveries') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.engagement_deliveries REPLICA IDENTITY FULL';
        IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
            AND NOT EXISTS (
                SELECT 1
                FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime'
                    AND schemaname = 'public'
                    AND tablename = 'engagement_deliveries'
            )
        THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.engagement_deliveries;
        END IF;
    END IF;

    IF TO_REGCLASS('public.user_tags') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.user_tags REPLICA IDENTITY FULL';
        IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
            AND NOT EXISTS (
                SELECT 1
                FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime'
                    AND schemaname = 'public'
                    AND tablename = 'user_tags'
            )
        THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.user_tags;
        END IF;
    END IF;

    IF TO_REGCLASS('public.engagement_user_activity') IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.engagement_user_activity REPLICA IDENTITY FULL';
        IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
            AND NOT EXISTS (
                SELECT 1
                FROM pg_publication_tables
                WHERE pubname = 'supabase_realtime'
                    AND schemaname = 'public'
                    AND tablename = 'engagement_user_activity'
            )
        THEN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.engagement_user_activity;
        END IF;
    END IF;
END $$;
