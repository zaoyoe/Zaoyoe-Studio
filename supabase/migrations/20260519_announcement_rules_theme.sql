-- Add a theme column to announcement_rules so administrators can pick a light/dark/auto
-- background for the in-site announcement (modal/banner/toast) regardless of the
-- visitor's site theme. Legacy rows default to 'auto' which preserves current behavior.

ALTER TABLE public.announcement_rules
    ADD COLUMN IF NOT EXISTS theme VARCHAR(16) DEFAULT 'auto' NOT NULL;

UPDATE public.announcement_rules
SET theme = 'auto'
WHERE theme IS NULL OR LOWER(BTRIM(theme)) NOT IN ('auto', 'light', 'dark');

ALTER TABLE public.announcement_rules
    DROP CONSTRAINT IF EXISTS announcement_rules_theme_check;

ALTER TABLE public.announcement_rules
    ADD CONSTRAINT announcement_rules_theme_check CHECK (theme IN ('auto', 'light', 'dark'));

COMMENT ON COLUMN public.announcement_rules.theme IS
    'Announcement display theme: auto (follow site theme), light (light background), dark (dark background).';
