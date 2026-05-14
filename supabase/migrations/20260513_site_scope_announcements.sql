-- Scope announcement workflow rows by site so CN and INTL announcements do not leak across storefronts.

ALTER TABLE public.announcement_rules
    ADD COLUMN IF NOT EXISTS site VARCHAR(16) DEFAULT 'cn' NOT NULL;

UPDATE public.announcement_rules
SET site = CASE WHEN LOWER(BTRIM(COALESCE(site, 'cn'))) = 'intl' THEN 'intl' ELSE 'cn' END
WHERE site IS DISTINCT FROM CASE WHEN LOWER(BTRIM(COALESCE(site, 'cn'))) = 'intl' THEN 'intl' ELSE 'cn' END;

ALTER TABLE public.announcement_rules
    DROP CONSTRAINT IF EXISTS announcement_rules_site_check;

ALTER TABLE public.announcement_rules
    ADD CONSTRAINT announcement_rules_site_check CHECK (site IN ('cn', 'intl'));

CREATE INDEX IF NOT EXISTS idx_announcement_rules_site_public_lookup
    ON public.announcement_rules (site, enabled, status, priority DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_announcement_rules_site_status_updated
    ON public.announcement_rules (site, status, updated_at DESC);

COMMENT ON COLUMN public.announcement_rules.site IS 'Site scope for public/admin announcement workflow. Legacy rows are treated as CN.';
