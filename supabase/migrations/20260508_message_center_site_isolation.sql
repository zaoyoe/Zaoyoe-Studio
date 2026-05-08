ALTER TABLE public.system_notifications
    ADD COLUMN IF NOT EXISTS site text;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'system_notifications'
          AND column_name = 'metadata'
    ) THEN
        EXECUTE $sql$
            UPDATE public.system_notifications
            SET site = CASE
                WHEN lower(coalesce(nullif(metadata->>'site', ''), nullif(site, ''), 'cn')) IN ('cn', 'intl')
                    THEN lower(coalesce(nullif(metadata->>'site', ''), nullif(site, ''), 'cn'))
                ELSE 'cn'
            END
            WHERE site IS NULL
               OR lower(site) NOT IN ('cn', 'intl')
        $sql$;
    ELSE
        UPDATE public.system_notifications
        SET site = 'cn'
        WHERE site IS NULL
           OR lower(site) NOT IN ('cn', 'intl');
    END IF;
END $$;

ALTER TABLE public.system_notifications
    ALTER COLUMN site SET DEFAULT 'cn';

ALTER TABLE public.system_notifications
    ALTER COLUMN site SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'system_notifications_site_check'
          AND conrelid = 'public.system_notifications'::regclass
    ) THEN
        ALTER TABLE public.system_notifications
            ADD CONSTRAINT system_notifications_site_check
            CHECK (site IN ('cn', 'intl'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_system_notifications_user_site_created_at
    ON public.system_notifications (user_id, site, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_notifications_user_site_scope_created_at
    ON public.system_notifications (user_id, site, scope, created_at DESC);
