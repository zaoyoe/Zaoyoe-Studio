BEGIN;

ALTER TABLE public.ops_alert_cases
    ADD COLUMN IF NOT EXISTS site TEXT;

UPDATE public.ops_alert_cases
SET site = CASE
    WHEN LOWER(NULLIF(BTRIM(metadata->>'site'), '')) IN ('cn', 'intl', 'all')
        THEN LOWER(NULLIF(BTRIM(metadata->>'site'), ''))
    WHEN LOWER(target_id) ~ '(^|:)intl(:|$)'
        THEN 'intl'
    WHEN LOWER(target_id) ~ '(^|:)all(:|$)'
        THEN 'all'
    ELSE 'cn'
END
WHERE site IS NULL OR BTRIM(site) = '';

ALTER TABLE public.ops_alert_cases
    ALTER COLUMN site SET DEFAULT 'cn',
    ALTER COLUMN site SET NOT NULL;

ALTER TABLE public.ops_alert_cases
    DROP CONSTRAINT IF EXISTS ops_alert_cases_site_check;

ALTER TABLE public.ops_alert_cases
    ADD CONSTRAINT ops_alert_cases_site_check
    CHECK (site IN ('cn', 'intl', 'all'));

ALTER TABLE public.ops_alert_cases
    DROP CONSTRAINT IF EXISTS ops_alert_cases_category_key_target_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_alert_cases_site_category_target
    ON public.ops_alert_cases(site, category_key, target_id);

CREATE INDEX IF NOT EXISTS idx_ops_alert_cases_site_status
    ON public.ops_alert_cases(site, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_alert_cases_site_category_status
    ON public.ops_alert_cases(site, category_key, status, updated_at DESC);

ALTER TABLE public.ops_alert_case_events
    ADD COLUMN IF NOT EXISTS site TEXT;

UPDATE public.ops_alert_case_events
SET site = CASE
    WHEN LOWER(NULLIF(BTRIM(metadata->>'site'), '')) IN ('cn', 'intl', 'all')
        THEN LOWER(NULLIF(BTRIM(metadata->>'site'), ''))
    WHEN LOWER(target_id) ~ '(^|:)intl(:|$)'
        THEN 'intl'
    WHEN LOWER(target_id) ~ '(^|:)all(:|$)'
        THEN 'all'
    ELSE 'cn'
END
WHERE site IS NULL OR BTRIM(site) = '';

ALTER TABLE public.ops_alert_case_events
    ALTER COLUMN site SET DEFAULT 'cn',
    ALTER COLUMN site SET NOT NULL;

ALTER TABLE public.ops_alert_case_events
    DROP CONSTRAINT IF EXISTS ops_alert_case_events_site_check;

ALTER TABLE public.ops_alert_case_events
    ADD CONSTRAINT ops_alert_case_events_site_check
    CHECK (site IN ('cn', 'intl', 'all'));

CREATE INDEX IF NOT EXISTS idx_ops_alert_case_events_site_target_created
    ON public.ops_alert_case_events(site, category_key, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ops_alert_case_events_site_action_created
    ON public.ops_alert_case_events(site, action, created_at DESC);

COMMENT ON COLUMN public.ops_alert_cases.site IS 'Site scope for centralized ops alert case state';
COMMENT ON COLUMN public.ops_alert_case_events.site IS 'Site scope for centralized ops alert case event history';

COMMIT;
