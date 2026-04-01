BEGIN;

CREATE OR REPLACE FUNCTION public.fn_get_homepage_config(
    p_site VARCHAR DEFAULT 'cn',
    p_include_hidden BOOLEAN DEFAULT false
)
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
    SELECT
        hc.section,
        hc.content,
        hc.is_visible,
        hc.display_order
    FROM public.homepage_config hc
    WHERE hc.site = CASE WHEN p_site = 'intl' THEN 'intl' ELSE 'cn' END
      AND (p_include_hidden OR hc.is_visible = true)
    ORDER BY hc.display_order ASC;
$$;

COMMIT;
