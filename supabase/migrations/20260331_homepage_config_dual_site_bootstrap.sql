BEGIN;

ALTER TABLE public.homepage_config
    ADD COLUMN IF NOT EXISTS site VARCHAR(10);

CREATE OR REPLACE FUNCTION public.normalize_homepage_content_for_site(
    p_content JSONB,
    p_site TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_content JSONB := COALESCE(p_content, '{}'::JSONB);
    v_field TEXT;
    v_base_value TEXT;
    v_site_value TEXT;
BEGIN
    FOREACH v_field IN ARRAY ARRAY['title', 'subtitle', 'section_title', 'section_subtitle']
    LOOP
        v_base_value := NULLIF(BTRIM(v_content ->> v_field), '');

        IF p_site = 'intl' THEN
            v_site_value := NULLIF(BTRIM(v_content ->> (v_field || '_en')), '');
            IF v_site_value IS NOT NULL THEN
                IF v_base_value IS NOT NULL AND NULLIF(BTRIM(v_content ->> (v_field || '_zh')), '') IS NULL THEN
                    v_content := jsonb_set(v_content, ARRAY[v_field || '_zh'], to_jsonb(v_base_value), true);
                END IF;
                v_content := jsonb_set(v_content, ARRAY[v_field], to_jsonb(v_site_value), true);
            END IF;
        ELSE
            v_site_value := NULLIF(BTRIM(v_content ->> (v_field || '_zh')), '');
            IF v_site_value IS NOT NULL THEN
                IF v_base_value IS NOT NULL AND NULLIF(BTRIM(v_content ->> (v_field || '_en')), '') IS NULL THEN
                    v_content := jsonb_set(v_content, ARRAY[v_field || '_en'], to_jsonb(v_base_value), true);
                END IF;
                v_content := jsonb_set(v_content, ARRAY[v_field], to_jsonb(v_site_value), true);
            END IF;
        END IF;
    END LOOP;

    RETURN v_content;
END;
$$;

UPDATE public.homepage_config
SET site = 'cn'
WHERE site IS NULL;

UPDATE public.homepage_config
SET content = public.normalize_homepage_content_for_site(content, 'cn')
WHERE site = 'cn';

ALTER TABLE public.homepage_config
    DROP CONSTRAINT IF EXISTS homepage_config_section_key;

INSERT INTO public.homepage_config (
    section,
    site,
    content,
    is_visible,
    display_order,
    updated_by,
    updated_at,
    created_at
)
SELECT
    src.section,
    'intl',
    public.normalize_homepage_content_for_site(src.content, 'intl'),
    src.is_visible,
    src.display_order,
    src.updated_by,
    src.updated_at,
    src.created_at
FROM public.homepage_config AS src
WHERE src.site = 'cn'
  AND NOT EXISTS (
      SELECT 1
      FROM public.homepage_config AS existing
      WHERE existing.section = src.section
        AND existing.site = 'intl'
  );

ALTER TABLE public.homepage_config
    ALTER COLUMN site SET DEFAULT 'cn';

UPDATE public.homepage_config
SET site = 'cn'
WHERE site IS NULL;

ALTER TABLE public.homepage_config
    ALTER COLUMN site SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.homepage_config'::regclass
          AND conname = 'homepage_config_site_check'
    ) THEN
        ALTER TABLE public.homepage_config
            ADD CONSTRAINT homepage_config_site_check
            CHECK (site IN ('cn', 'intl'));
    END IF;
END;
$$;

DROP INDEX IF EXISTS public.idx_homepage_config_section;
DROP INDEX IF EXISTS public.idx_homepage_config_visible;

CREATE UNIQUE INDEX IF NOT EXISTS idx_homepage_config_site_section
    ON public.homepage_config(site, section);

CREATE INDEX IF NOT EXISTS idx_homepage_config_section
    ON public.homepage_config(section);

CREATE INDEX IF NOT EXISTS idx_homepage_config_site_visible_order
    ON public.homepage_config(site, is_visible, display_order);

CREATE OR REPLACE FUNCTION public.fn_get_homepage_config(p_site VARCHAR DEFAULT 'cn')
RETURNS TABLE (
    section VARCHAR,
    content JSONB,
    is_visible BOOLEAN,
    display_order INT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT section, content, is_visible, display_order
    FROM public.homepage_config
    WHERE site = CASE WHEN p_site = 'intl' THEN 'intl' ELSE 'cn' END
      AND is_visible = true
    ORDER BY display_order ASC;
$$;

COMMENT ON COLUMN public.homepage_config.site IS '站点标识符，仅允许 cn 或 intl';

COMMIT;
